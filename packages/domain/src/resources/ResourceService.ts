import type { AuditTrail } from '../audit/AuditTrail';
import { CancellationReason } from '../bookings/Booking';
import type { BookingRepository } from '../bookings/BookingRepository';
import type { BookingRevocation } from '../bookings/BookingRevocation';
import { TimeSlot, peakConcurrency } from '../bookings/TimeSlot';
import type { Actor } from '../identity/Actor';
import { assertCrewLead, assertPassenger } from '../identity/authorization';
import { compareTiers } from '../membership/MembershipTier';
import { ConflictError, NotFoundError, TierAccessDeniedError } from '../shared/errors';
import type { Clock, IdGenerator } from '../shared/ports';
import { findPassengerOrThrow } from '../users/lookups';
import type { UserRepository } from '../users/UserRepository';
import { Resource, type ResourceChanges, type ResourceSpec } from './Resource';
import type { ResourceRepository } from './ResourceRepository';

export interface ResourceUpdateResult {
  resource: Resource;
  revokedBookingIds: string[];
}

export interface ResourceServiceDeps {
  resources: ResourceRepository;
  bookings: BookingRepository;
  users: UserRepository;
  revocation: BookingRevocation;
  audit: AuditTrail;
  ids: IdGenerator;
  clock: Clock;
}

const byTierThenName = (a: Resource, b: Resource) =>
  compareTiers(a.minTier, b.minTier) || a.name.localeCompare(b.name);

/** Resource inventory: provisioning and decommissioning (Crew Leads) and discovery (passengers). */
export class ResourceService {
  constructor(private readonly deps: ResourceServiceDeps) {}

  provision(actor: Actor, spec: ResourceSpec): Promise<Resource> {
    return this.deps.audit.track(
      {
        actor,
        action: 'RESOURCE_PROVISION',
        subject: { type: 'RESOURCE', id: null },
        details: { name: String(spec.name), minTier: String(spec.minTier) },
      },
      async (tx) => {
        assertCrewLead(actor);
        const resource = Resource.provision({
          ...spec,
          id: this.deps.ids.next(),
          createdAt: this.deps.clock.now(),
        });
        await tx.resources.save(resource);
        return resource;
      },
      (resource) => ({ subjectId: resource.id, details: { capacity: resource.capacity } }),
    );
  }

  /** Full inventory, including decommissioned resources. */
  async listAll(actor: Actor): Promise<Resource[]> {
    assertCrewLead(actor);
    return (await this.deps.resources.findAll()).sort(byTierThenName);
  }

  /** Resource discovery: only active resources the passenger's tier grants. */
  async listAccessible(actor: Actor): Promise<Resource[]> {
    assertPassenger(actor);
    const passenger = await findPassengerOrThrow(this.deps.users, actor.userId);
    return (await this.deps.resources.findAll())
      .filter((r) => r.isActive && r.isAccessibleTo(passenger.tier))
      .sort(byTierThenName);
  }

  async get(actor: Actor, resourceId: string): Promise<Resource> {
    const resource = await findOrThrow(this.deps.resources, resourceId);
    if (actor.role === 'CREW_LEAD') return resource;

    assertPassenger(actor);
    const passenger = await findPassengerOrThrow(this.deps.users, actor.userId);
    if (!resource.isActive) throw new NotFoundError('Resource', resourceId);
    if (!resource.isAccessibleTo(passenger.tier)) {
      throw new TierAccessDeniedError(
        `${resource.name} requires ${resource.minTier} membership or higher.`,
      );
    }
    return resource;
  }

  /**
   * Edits a resource. Reducing capacity is refused if upcoming bookings would no
   * longer fit; raising the minimum tier revokes pending bookings of passengers
   * who lose access, in the same unit of work.
   */
  update(
    actor: Actor,
    resourceId: string,
    changes: ResourceChanges,
  ): Promise<ResourceUpdateResult> {
    return this.deps.audit.track(
      {
        actor,
        action: 'RESOURCE_UPDATE',
        subject: { type: 'RESOURCE', id: resourceId },
        details: { changes: Object.keys(changes).sort().join(',') },
      },
      async (tx) => {
        assertCrewLead(actor);
        // Both checks below decide from the resource's bookings: keep new ones out meanwhile.
        await tx.lockSchedule({ resourceId });
        const resource = await findOrThrow(tx.resources, resourceId);
        const now = this.deps.clock.now();
        const notEnded = await tx.bookings.findByResource(resourceId, TimeSlot.onwardsFrom(now));
        const upcoming = notEnded.filter((b) => b.isActive);

        if (changes.capacity !== undefined && changes.capacity < resource.capacity) {
          const peak = peakConcurrency(upcoming.map((b) => b.slot));
          if (peak > changes.capacity) {
            throw new ConflictError(
              'CAPACITY_EXCEEDED',
              `Capacity cannot drop to ${changes.capacity}: ${peak} upcoming bookings overlap.`,
            );
          }
        }

        const previousMinTier = resource.minTier;
        resource.update(changes);
        await tx.resources.save(resource);

        let revoked: string[] = [];
        if (compareTiers(resource.minTier, previousMinTier) > 0) {
          const losingAccess = [];
          for (const booking of upcoming) {
            const passenger = await findPassengerOrThrow(tx.users, booking.passengerId);
            if (!resource.isAccessibleTo(passenger.tier)) losingAccess.push(booking);
          }
          revoked = (
            await this.deps.revocation.revokePending(
              tx,
              actor,
              losingAccess,
              CancellationReason.RESOURCE_TIER_RAISED,
            )
          ).map((b) => b.id);
        }
        return { resource, revokedBookingIds: revoked };
      },
      ({ revokedBookingIds }) => ({ details: { revokedBookings: revokedBookingIds.length } }),
    );
  }

  /** Takes a resource out of service and revokes its pending bookings, in one unit of work. */
  decommission(actor: Actor, resourceId: string): Promise<ResourceUpdateResult> {
    return this.deps.audit.track(
      { actor, action: 'RESOURCE_DECOMMISSION', subject: { type: 'RESOURCE', id: resourceId } },
      async (tx) => {
        assertCrewLead(actor);
        await tx.lockSchedule({ resourceId });
        const resource = await findOrThrow(tx.resources, resourceId);
        const now = this.deps.clock.now();
        resource.decommission(now);
        await tx.resources.save(resource);
        const revoked = await this.deps.revocation.revokePending(
          tx,
          actor,
          await tx.bookings.findByResource(resourceId, TimeSlot.onwardsFrom(now)),
          CancellationReason.RESOURCE_DECOMMISSIONED,
        );
        return { resource, revokedBookingIds: revoked.map((b) => b.id) };
      },
      ({ revokedBookingIds }) => ({ details: { revokedBookings: revokedBookingIds.length } }),
    );
  }
}

async function findOrThrow(resources: ResourceRepository, resourceId: string): Promise<Resource> {
  const resource = await resources.findById(resourceId);
  if (!resource) throw new NotFoundError('Resource', resourceId);
  return resource;
}
