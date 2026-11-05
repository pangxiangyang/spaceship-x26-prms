import type { AuditTrail } from '../audit/AuditTrail';
import { CancellationReason } from '../bookings/Booking';
import type { BookingRepository } from '../bookings/BookingRepository';
import type { BookingRevocation } from '../bookings/BookingRevocation';
import type { Actor } from '../identity/Actor';
import { assertCrewLead, assertSelfOrCrewLead } from '../identity/authorization';
import type { MembershipTier } from '../membership/MembershipTier';
import type { ResourceRepository } from '../resources/ResourceRepository';
import type { AsyncMutex } from '../shared/AsyncMutex';
import { ConflictError } from '../shared/errors';
import type { Clock, IdGenerator } from '../shared/ports';
import { findPassengerOrThrow } from './lookups';
import { Passenger, normalizeUsername, type TierChange } from './User';
import type { UserRepository } from './UserRepository';

export interface CreatePassengerInput {
  username: string;
  displayName: string;
  tier: MembershipTier;
}

export interface TierChangeResult {
  passenger: Passenger;
  change: TierChange;
  /** Bookings cancelled because the new tier no longer grants access. */
  revokedBookingIds: string[];
}

export interface PassengerServiceDeps {
  users: UserRepository;
  resources: ResourceRepository;
  bookings: BookingRepository;
  revocation: BookingRevocation;
  audit: AuditTrail;
  ids: IdGenerator;
  clock: Clock;
  bookingLock: AsyncMutex;
}

/** Crew Lead management of passenger profiles and membership tiers. */
export class PassengerService {
  constructor(private readonly deps: PassengerServiceDeps) {}

  async create(actor: Actor, input: CreatePassengerInput): Promise<Passenger> {
    return this.deps.audit.track(
      {
        actor,
        action: 'PASSENGER_CREATE',
        subject: { type: 'PASSENGER', id: null },
        details: { username: String(input.username), tier: String(input.tier) },
      },
      async () => {
        assertCrewLead(actor);
        const username = normalizeUsername(input.username);
        if (await this.deps.users.findByUsername(username)) {
          throw new ConflictError('USERNAME_TAKEN', `Username '${username}' is already taken.`);
        }
        const passenger = Passenger.create({
          id: this.deps.ids.next(),
          username,
          displayName: input.displayName,
          tier: input.tier,
          createdAt: this.deps.clock.now(),
        });
        await this.deps.users.save(passenger);
        return passenger;
      },
      (passenger) => ({ subjectId: passenger.id }),
    );
  }

  async list(actor: Actor): Promise<Passenger[]> {
    assertCrewLead(actor);
    const passengers = await this.deps.users.findPassengers();
    return passengers.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async get(actor: Actor, passengerId: string): Promise<Passenger> {
    assertSelfOrCrewLead(actor, passengerId);
    return findPassengerOrThrow(this.deps.users, passengerId);
  }

  async rename(actor: Actor, passengerId: string, displayName: string): Promise<Passenger> {
    return this.deps.audit.track(
      { actor, action: 'PASSENGER_UPDATE', subject: { type: 'PASSENGER', id: passengerId } },
      async () => {
        assertCrewLead(actor);
        const passenger = await findPassengerOrThrow(this.deps.users, passengerId);
        passenger.rename(displayName);
        await this.deps.users.save(passenger);
        return passenger;
      },
      (passenger) => ({ details: { displayName: passenger.displayName } }),
    );
  }

  /**
   * Upgrades or downgrades a passenger. A downgrade immediately revokes pending
   * bookings for resources the passenger is no longer entitled to.
   */
  changeTier(actor: Actor, passengerId: string, tier: MembershipTier): Promise<TierChangeResult> {
    return this.deps.bookingLock.runExclusive(() =>
      this.deps.audit.track(
        {
          actor,
          action: 'TIER_CHANGE',
          subject: { type: 'PASSENGER', id: passengerId },
          details: { requestedTier: String(tier) },
        },
        async () => {
          assertCrewLead(actor);
          const passenger = await findPassengerOrThrow(this.deps.users, passengerId);
          const change = passenger.changeTier(tier);
          await this.deps.users.save(passenger);

          const revoked =
            change.direction === 'DOWNGRADE'
              ? await this.revokeNoLongerAccessible(actor, passenger)
              : [];
          return { passenger, change, revokedBookingIds: revoked.map((b) => b.id) };
        },
        ({ change, revokedBookingIds }) => ({
          details: {
            from: change.from,
            to: change.to,
            direction: change.direction,
            revokedBookings: revokedBookingIds.length,
          },
        }),
      ),
    );
  }

  private async revokeNoLongerAccessible(actor: Actor, passenger: Passenger) {
    const bookings = await this.deps.bookings.findByPassenger(passenger.id);
    const resources = new Map(
      (await this.deps.resources.findAll()).map((resource) => [resource.id, resource]),
    );
    const inaccessible = bookings.filter((booking) => {
      const resource = resources.get(booking.resourceId);
      return resource !== undefined && !resource.isAccessibleTo(passenger.tier);
    });
    return this.deps.revocation.revokePending(
      actor,
      inaccessible,
      CancellationReason.TIER_DOWNGRADE,
    );
  }
}
