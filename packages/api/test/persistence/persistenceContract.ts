import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Booking,
  ConflictError,
  CrewLead,
  Passenger,
  Resource,
  TimeSlot,
  type AuditEvent,
  type AuditQuery,
} from '@prms/domain';
import type { Persistence } from '../../src/persistence/Persistence';

const at = (hhmm: string) => new Date(`2026-03-01T${hhmm}:00.000Z`);

const passenger = (id: string, username: string) =>
  Passenger.create({
    id,
    username,
    displayName: `Pax ${id}`,
    tier: 'SILVER',
    createdAt: at('08:00'),
  });

const crewLead = (id: string, username: string) =>
  CrewLead.create({ id, username, displayName: `Lead ${id}`, createdAt: at('07:00') });

const resource = (id: string) =>
  Resource.provision({
    id,
    name: `Pod ${id}`,
    description: 'Quiet',
    category: 'SLEEPING_POD',
    minTier: 'GOLD',
    capacity: 3,
    createdAt: at('08:00'),
  });

const booking = (id: string, passengerId: string, resourceId: string) =>
  Booking.create({
    id,
    passengerId,
    resourceId,
    passengerTier: 'GOLD',
    slot: TimeSlot.of(at('10:00'), at('11:00')),
    createdAt: at('08:30'),
  });

const event = (
  id: string,
  occurredAt: string,
  overrides: Partial<AuditEvent> = {},
): AuditEvent => ({
  id,
  occurredAt: at(occurredAt),
  actor: { userId: 'pax-1', role: 'PASSENGER' },
  action: 'BOOKING_CREATE',
  outcome: 'SUCCESS',
  subject: { type: 'RESOURCE', id: 'res-1' },
  details: { start: '2026-03-01T10:00:00.000Z', bookingId: 'b-1' },
  ...overrides,
});

const deniedEvent = () =>
  event('e-3', '09:10', { outcome: 'DENIED', details: { reason: 'CAPACITY_EXCEEDED' } });

/**
 * Behaviour every storage backend must share. Domain services rely on these
 * semantics, so the same suite runs against the in-memory stores and Firestore.
 */
export function describePersistenceContract(
  name: string,
  createPersistence: () => Promise<Persistence> | Persistence,
): void {
  describe(`${name} persistence contract`, () => {
    let store: Persistence;
    const opened: Persistence[] = [];

    beforeEach(async () => {
      store = await createPersistence();
      opened.push(store);
    });

    afterAll(async () => {
      for (const persistence of opened) {
        await persistence.wipe();
        await persistence.close();
      }
    });

    describe('users', () => {
      it('finds users by id and by case-insensitive username', async () => {
        const { users } = store.repositories;
        await users.save(passenger('pax-1', 'ada.lovelace'));
        await users.save(crewLead('crew-1', 'commander'));

        expect(await users.findById('pax-1')).toMatchObject({
          username: 'ada.lovelace',
          tier: 'SILVER',
        });
        expect(await users.findById('crew-1')).toBeInstanceOf(CrewLead);
        expect((await users.findByUsername(' Ada.Lovelace '))?.id).toBe('pax-1');
        expect(await users.findById('missing')).toBeUndefined();
        expect(await users.findByUsername('nobody')).toBeUndefined();
      });

      it('lists passengers and crew leads separately', async () => {
        const { users } = store.repositories;
        await users.save(passenger('pax-1', 'ada'));
        await users.save(passenger('pax-2', 'grace'));
        await users.save(crewLead('crew-1', 'commander'));

        expect((await users.findPassengers()).map((p) => p.id).sort()).toEqual(['pax-1', 'pax-2']);
        expect((await users.findCrewLeads()).map((c) => c.id)).toEqual(['crew-1']);
      });

      it('persists changes made after loading', async () => {
        const { users } = store.repositories;
        await users.save(passenger('pax-1', 'ada'));
        const loaded = (await users.findById('pax-1')) as Passenger;
        loaded.changeTier('PLATINUM');
        loaded.rename('Countess Ada');
        await users.save(loaded);

        expect(await users.findById('pax-1')).toMatchObject({
          tier: 'PLATINUM',
          displayName: 'Countess Ada',
        });
      });

      it('refuses a second account with the same username', async () => {
        const { users } = store.repositories;
        await users.save(passenger('pax-1', 'ada'));
        await expect(users.save(passenger('pax-2', 'ada'))).rejects.toThrow(ConflictError);
        expect(await users.findById('pax-2')).toBeUndefined();
      });
    });

    describe('resources', () => {
      it('round-trips resources including their status', async () => {
        const { resources } = store.repositories;
        const retired = resource('res-2');
        retired.decommission(at('09:00'));
        await resources.save(resource('res-1'));
        await resources.save(retired);

        expect((await resources.findById('res-1'))?.toSnapshot()).toEqual(
          resource('res-1').toSnapshot(),
        );
        expect((await resources.findById('res-2'))?.toSnapshot()).toEqual(retired.toSnapshot());
        expect((await resources.findAll()).map((r) => r.id).sort()).toEqual(['res-1', 'res-2']);
        expect(await resources.findById('missing')).toBeUndefined();
      });
    });

    describe('bookings', () => {
      it('round-trips bookings and finds them by passenger and by resource', async () => {
        const { bookings } = store.repositories;
        await bookings.save(booking('b-1', 'pax-1', 'res-1'));
        await bookings.save(booking('b-2', 'pax-1', 'res-2'));
        await bookings.save(booking('b-3', 'pax-2', 'res-1'));

        expect((await bookings.findById('b-1'))?.toSnapshot()).toEqual(
          booking('b-1', 'pax-1', 'res-1').toSnapshot(),
        );
        const ids = (list: { id: string }[]) => list.map((b) => b.id).sort();
        expect(ids(await bookings.findByPassenger('pax-1'))).toEqual(['b-1', 'b-2']);
        expect(ids(await bookings.findByResource('res-1'))).toEqual(['b-1', 'b-3']);
        expect(await bookings.findAll()).toHaveLength(3);
        expect(await bookings.findById('missing')).toBeUndefined();
      });

      it('persists state transitions', async () => {
        const { bookings } = store.repositories;
        await bookings.save(booking('b-1', 'pax-1', 'res-1'));
        const loaded = (await bookings.findById('b-1'))!;
        loaded.cancel(at('09:00'), 'TIER_DOWNGRADE');
        await bookings.save(loaded);

        expect(await bookings.findById('b-1')).toMatchObject({
          status: 'CANCELLED',
          cancellationReason: 'TIER_DOWNGRADE',
          cancelledAt: at('09:00'),
        });
      });
    });

    describe('audit log', () => {
      beforeEach(async () => {
        const { auditLog } = store.repositories;
        await auditLog.append(event('e-1', '09:00'));
        await auditLog.append(
          event('e-2', '09:05', {
            actor: { userId: 'crew-1', role: 'CREW_LEAD' },
            action: 'TIER_CHANGE',
            subject: { type: 'PASSENGER', id: 'pax-1' },
            details: { from: 'SILVER', to: 'GOLD', revokedBookings: 0, note: null },
          }),
        );
        await auditLog.append(deniedEvent());
        await auditLog.append(event('e-4', '09:15', { subject: { type: 'CREW_LEAD', id: null } }));
      });

      it('returns complete events newest first with a total', async () => {
        const page = await store.repositories.auditLog.query({});
        expect(page.total).toBe(4);
        expect(page.items.map((e) => e.id)).toEqual(['e-4', 'e-3', 'e-2', 'e-1']);
        expect(page.items[1]).toEqual(deniedEvent());
      });

      it('combines filters, time ranges and paging', async () => {
        const { auditLog } = store.repositories;
        const ids = async (query: AuditQuery) =>
          (await auditLog.query(query)).items.map((e) => e.id);

        expect(await ids({ action: 'BOOKING_CREATE', outcome: 'DENIED' })).toEqual(['e-3']);
        expect(await ids({ actorId: 'crew-1' })).toEqual(['e-2']);
        expect(await ids({ subjectId: 'res-1', outcome: 'SUCCESS' })).toEqual(['e-1']);
        expect(await ids({ from: at('09:05'), to: at('09:10') })).toEqual(['e-3', 'e-2']);
        expect(await ids({ limit: 2, offset: 1 })).toEqual(['e-3', 'e-2']);
        expect((await auditLog.query({ limit: 2, offset: 1 })).total).toBe(4);
      });
    });

    describe('credentials', () => {
      it('stores and replaces password hashes', async () => {
        const { credentials } = store;
        expect(await credentials.getPasswordHash('pax-1')).toBeUndefined();
        await credentials.setPasswordHash('pax-1', 'hash-1');
        await credentials.setPasswordHash('pax-1', 'hash-2');
        expect(await credentials.getPasswordHash('pax-1')).toBe('hash-2');
      });
    });

    describe('demo seed marker and wipe', () => {
      it('lets exactly one process claim the demo seed', async () => {
        expect(await store.demoSeed.claim(at('08:00'))).toBe(true);
        expect(await store.demoSeed.claim(at('08:01'))).toBe(false);
      });

      it('wipes every collection and releases the seed marker', async () => {
        await store.repositories.users.save(passenger('pax-1', 'ada'));
        await store.repositories.resources.save(resource('res-1'));
        await store.repositories.bookings.save(booking('b-1', 'pax-1', 'res-1'));
        await store.repositories.auditLog.append(event('e-1', '09:00'));
        await store.credentials.setPasswordHash('pax-1', 'hash');
        await store.demoSeed.claim(at('08:00'));

        await store.wipe();

        expect(await store.repositories.users.findPassengers()).toEqual([]);
        expect(await store.repositories.resources.findAll()).toEqual([]);
        expect(await store.repositories.bookings.findAll()).toEqual([]);
        expect((await store.repositories.auditLog.query({})).total).toBe(0);
        expect(await store.credentials.getPasswordHash('pax-1')).toBeUndefined();
        expect(await store.demoSeed.claim(at('08:00'))).toBe(true);
      });
    });
  });
}
