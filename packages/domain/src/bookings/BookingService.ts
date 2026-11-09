import type { AuditTrail } from '../audit/AuditTrail';
import { Role, type Actor } from '../identity/Actor';
import { assertPassenger, assertSelfOrCrewLead } from '../identity/authorization';
import type { Resource } from '../resources/Resource';
import type { ResourceRepository } from '../resources/ResourceRepository';
import type { AsyncMutex } from '../shared/AsyncMutex';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TierAccessDeniedError,
  ValidationError,
} from '../shared/errors';
import type { Clock, IdGenerator } from '../shared/ports';
import { findPassengerOrThrow } from '../users/lookups';
import type { Passenger } from '../users/User';
import type { UserRepository } from '../users/UserRepository';
import { Booking, CancellationReason } from './Booking';
import type { BookingPolicy } from './BookingPolicy';
import type { BookingRepository } from './BookingRepository';
import { TimeSlot, peakConcurrency } from './TimeSlot';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Tolerates a request whose start was "now" when the passenger pressed the button. */
const START_GRACE_MS = MINUTE_MS;

export interface BookResourceInput {
  resourceId: string;
  start: Date;
  end: Date;
}

/** A new booking together with the resource as it was checked when booking. */
export interface BookingConfirmation {
  booking: Booking;
  resource: Resource;
}

export interface ResourceOccupancy {
  resource: Resource;
  /** Anonymised occupied slots inside the requested window. */
  occupied: TimeSlot[];
}

export interface BookingServiceDeps {
  bookings: BookingRepository;
  resources: ResourceRepository;
  users: UserRepository;
  audit: AuditTrail;
  ids: IdGenerator;
  clock: Clock;
  policy: BookingPolicy;
  bookingLock: AsyncMutex;
}

/**
 * Passenger-facing resource usage: booking, cancelling and checking in.
 * Every attempt — successful or denied — lands in the audit trail.
 */
export class BookingService {
  constructor(private readonly deps: BookingServiceDeps) {}

  book(actor: Actor, input: BookResourceInput): Promise<BookingConfirmation> {
    return this.deps.audit.track(
      {
        actor,
        action: 'BOOKING_CREATE',
        subject: { type: 'RESOURCE', id: input.resourceId },
        details: { start: isoOrNull(input.start), end: isoOrNull(input.end) },
      },
      () =>
        // Read-check-write on shared capacity: serialise to prevent double booking.
        this.deps.bookingLock.runExclusive(async () => {
          assertPassenger(actor);
          const now = this.deps.clock.now();
          const slot = TimeSlot.of(input.start, input.end);
          this.assertSlotAllowed(slot, now);

          const passenger = await findPassengerOrThrow(this.deps.users, actor.userId);
          const resource = await this.findResourceOrThrow(input.resourceId);
          this.assertUsable(resource, passenger);
          await this.assertPassengerIsFree(passenger.id, slot);
          await this.assertCapacityAvailable(resource, slot);

          const booking = Booking.create({
            id: this.deps.ids.next(),
            passengerId: passenger.id,
            resourceId: resource.id,
            passengerTier: passenger.tier,
            slot,
            createdAt: now,
          });
          await this.deps.bookings.save(booking);
          return { booking, resource };
        }),
      ({ booking }) => ({ details: { bookingId: booking.id } }),
    );
  }

  /** A passenger's own bookings (or any passenger's, for Crew Leads), newest first. */
  async listForPassenger(actor: Actor, passengerId: string): Promise<Booking[]> {
    assertSelfOrCrewLead(actor, passengerId);
    await findPassengerOrThrow(this.deps.users, passengerId);
    const bookings = await this.deps.bookings.findByPassenger(passengerId);
    return bookings.sort((a, b) => b.slot.start.getTime() - a.slot.start.getTime());
  }

  cancel(actor: Actor, bookingId: string): Promise<Booking> {
    return this.deps.audit.track(
      { actor, action: 'BOOKING_CANCEL', subject: { type: 'BOOKING', id: bookingId } },
      () =>
        this.deps.bookingLock.runExclusive(async () => {
          const booking = await this.findOwnedBookingOrThrow(actor, bookingId);
          const reason =
            actor.role === Role.CREW_LEAD
              ? CancellationReason.CREW_LEAD_REQUEST
              : CancellationReason.PASSENGER_REQUEST;
          booking.cancel(this.deps.clock.now(), reason);
          await this.deps.bookings.save(booking);
          return booking;
        }),
      (booking) => ({
        details: { reason: booking.cancellationReason ?? null, resourceId: booking.resourceId },
      }),
    );
  }

  /**
   * Starts using a booked resource. Entitlement is re-validated in real time:
   * a booking made before a downgrade or decommission cannot be used afterwards.
   */
  checkIn(actor: Actor, bookingId: string): Promise<Booking> {
    return this.deps.audit.track(
      { actor, action: 'USAGE_START', subject: { type: 'BOOKING', id: bookingId } },
      () =>
        this.deps.bookingLock.runExclusive(async () => {
          assertPassenger(actor);
          const booking = await this.findOwnedBookingOrThrow(actor, bookingId);
          const passenger = await findPassengerOrThrow(this.deps.users, actor.userId);
          const resource = await this.findResourceOrThrow(booking.resourceId);
          this.assertUsable(resource, passenger);
          booking.checkIn(this.deps.clock.now(), this.deps.policy.checkInLeadMinutes);
          await this.deps.bookings.save(booking);
          return booking;
        }),
      (booking) => ({ details: { resourceId: booking.resourceId } }),
    );
  }

  /** When a resource is busy within a window, without revealing who booked it. */
  async occupancy(actor: Actor, resourceId: string, window: TimeSlot): Promise<ResourceOccupancy> {
    const resource = await this.findResourceOrThrow(resourceId);
    if (actor.role === Role.PASSENGER) {
      const passenger = await findPassengerOrThrow(this.deps.users, actor.userId);
      this.assertUsable(resource, passenger);
    }
    const occupied = (await this.deps.bookings.findByResource(resourceId))
      .filter((b) => b.occupiesCapacity && b.slot.overlaps(window))
      .map((b) => b.slot)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    return { resource, occupied };
  }

  private assertSlotAllowed(slot: TimeSlot, now: Date): void {
    const { minDurationMinutes, maxDurationMinutes, maxAdvanceDays } = this.deps.policy;
    if (slot.durationMinutes < minDurationMinutes || slot.durationMinutes > maxDurationMinutes) {
      throw new ValidationError(
        `Bookings must last between ${minDurationMinutes} and ${maxDurationMinutes} minutes.`,
      );
    }
    if (slot.start.getTime() < now.getTime() - START_GRACE_MS) {
      throw new ValidationError('Bookings cannot start in the past.');
    }
    if (slot.start.getTime() > now.getTime() + maxAdvanceDays * DAY_MS) {
      throw new ValidationError(`Bookings can be made at most ${maxAdvanceDays} days ahead.`);
    }
  }

  private assertUsable(resource: Resource, passenger: Passenger): void {
    if (!resource.isActive) {
      throw new ConflictError(
        'RESOURCE_UNAVAILABLE',
        `${resource.name} has been decommissioned and cannot be used.`,
      );
    }
    if (!resource.isAccessibleTo(passenger.tier)) {
      throw new TierAccessDeniedError(
        `${resource.name} requires ${resource.minTier} membership; your tier is ${passenger.tier}.`,
      );
    }
  }

  private async assertPassengerIsFree(passengerId: string, slot: TimeSlot): Promise<void> {
    const own = await this.deps.bookings.findByPassenger(passengerId);
    if (own.some((b) => b.occupiesCapacity && b.slot.overlaps(slot))) {
      throw new ConflictError('BOOKING_OVERLAP', 'You already have a booking during this time.');
    }
  }

  private async assertCapacityAvailable(resource: Resource, slot: TimeSlot): Promise<void> {
    const existing = (await this.deps.bookings.findByResource(resource.id))
      .filter((b) => b.occupiesCapacity)
      .map((b) => b.slot);
    if (peakConcurrency(existing, slot) >= resource.capacity) {
      throw new ConflictError(
        'CAPACITY_EXCEEDED',
        `${resource.name} is fully booked for part of the requested time.`,
      );
    }
  }

  private async findResourceOrThrow(resourceId: string): Promise<Resource> {
    const resource = await this.deps.resources.findById(resourceId);
    if (!resource) throw new NotFoundError('Resource', resourceId);
    return resource;
  }

  private async findOwnedBookingOrThrow(actor: Actor, bookingId: string): Promise<Booking> {
    const booking = await this.deps.bookings.findById(bookingId);
    if (!booking) throw new NotFoundError('Booking', bookingId);
    if (actor.role === Role.PASSENGER && booking.passengerId !== actor.userId) {
      throw new ForbiddenError('You can only manage your own bookings.');
    }
    return booking;
  }
}

function isoOrNull(date: Date): string | null {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}
