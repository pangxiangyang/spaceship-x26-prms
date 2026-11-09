import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Booking,
  ConflictError,
  CrewLead,
  Passenger,
  Resource,
  Role,
  TimeSlot,
  createPrmsDomain,
  type Actor,
  type AuditEvent,
  type AuditQuery,
} from '@prms/domain';
import type { Persistence } from '../../src/persistence/Persistence';

const HOUR_MS = 60 * 60 * 1000;

/** A domain instance on shared storage, as a separate server process would build it. */
const domainOn = (store: Persistence) => createPrmsDomain({ storage: store });

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

      it('refuses the same username from concurrent writers', async () => {
        const { users } = store.repositories;
        const results = await Promise.allSettled([
          users.save(passenger('pax-1', 'ada')),
          users.save(passenger('pax-2', 'ada')),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect((await users.findPassengers()).map((p) => p.username)).toEqual(['ada']);
      });

      it('refuses a fourth crew lead, even written directly to storage', async () => {
        const { users } = store.repositories;
        for (const id of ['lead-1', 'lead-2', 'lead-3']) await users.save(crewLead(id, id));
        await expect(users.save(crewLead('lead-4', 'lead-4'))).rejects.toMatchObject({
          code: 'CREW_LEAD_LIMIT_REACHED',
        });
        // Saving an existing lead again is an update, not a fourth lead.
        await expect(users.save(crewLead('lead-1', 'lead-1'))).resolves.toBeUndefined();
        expect(await users.findCrewLeads()).toHaveLength(3);
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
        const allDay = TimeSlot.of(at('00:00'), at('23:59'));
        expect(ids(await bookings.findByResource('res-1', allDay))).toEqual(['b-1', 'b-3']);
        expect(await bookings.findAll()).toHaveLength(3);
        expect(await bookings.findById('missing')).toBeUndefined();
      });

      it('finds bookings overlapping a window, by resource, by passenger and overall', async () => {
        const { bookings } = store.repositories;
        const timed = (id: string, pax: string, res: string, from: string, to: string) =>
          Booking.create({
            id,
            passengerId: pax,
            resourceId: res,
            passengerTier: 'GOLD',
            slot: TimeSlot.of(at(from), at(to)),
            createdAt: at('07:00'),
          });
        await bookings.save(timed('b-early', 'pax-1', 'res-1', '08:00', '09:00'));
        await bookings.save(timed('b-mid', 'pax-1', 'res-1', '10:00', '11:00'));
        await bookings.save(timed('b-late', 'pax-2', 'res-1', '12:00', '13:00'));
        await bookings.save(timed('b-other', 'pax-2', 'res-2', '10:30', '11:30'));
        // Half-open: b-early ends as the window starts, b-late starts as it ends.
        const window = TimeSlot.of(at('09:00'), at('12:00'));

        const ids = (list: { id: string }[]) => list.map((b) => b.id).sort();
        expect(ids(await bookings.findByResource('res-1', window))).toEqual(['b-mid']);
        expect(ids(await bookings.findByPassenger('pax-1', window))).toEqual(['b-mid']);
        expect(ids(await bookings.findByPassenger('pax-1'))).toEqual(['b-early', 'b-mid']);
        expect(ids(await bookings.findOverlapping(window))).toEqual(['b-mid', 'b-other']);
        expect(ids(await bookings.findOverlapping(TimeSlot.onwardsFrom(at('11:15'))))).toEqual([
          'b-late',
          'b-other',
        ]);
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
        expect(
          await ids({ action: 'BOOKING_CREATE', outcome: 'SUCCESS', actorId: 'pax-1' }),
        ).toEqual(['e-4', 'e-1']);
      });

      it('filters by the business rule that refused an attempt', async () => {
        const { auditLog } = store.repositories;
        const ids = async (query: AuditQuery) =>
          (await auditLog.query(query)).items.map((e) => e.id);
        expect(await ids({ reason: 'CAPACITY_EXCEEDED' })).toEqual(['e-3']);
        expect(
          await ids({
            action: 'BOOKING_CREATE',
            outcome: 'DENIED',
            reason: 'CAPACITY_EXCEEDED',
            from: at('09:00'),
            to: at('09:30'),
          }),
        ).toEqual(['e-3']);
      });

      it('counts the total of a page that combines filters with a time range', async () => {
        const { auditLog } = store.repositories;
        const page = await auditLog.query({
          action: 'BOOKING_CREATE',
          from: at('09:05'),
          limit: 5,
        });
        expect(page.items.map((e) => e.id)).toEqual(['e-4', 'e-3']);
        expect(page.total).toBe(2);

        const denied = await auditLog.query({
          action: 'BOOKING_CREATE',
          outcome: 'DENIED',
          from: at('09:00'),
          to: at('09:30'),
          limit: 1,
        });
        expect(denied.items.map((e) => e.id)).toEqual(['e-3']);
        expect(denied.total).toBe(1);
      });

      it('pages with a cursor, newest first, with the total on every page', async () => {
        const { auditLog } = store.repositories;
        // Same moment as e-4: the id breaks the tie, so no event is skipped or repeated.
        await auditLog.append(event('e-5', '09:15'));

        const first = await auditLog.query({ limit: 2 });
        const second = await auditLog.query({ limit: 2, after: first.nextCursor! });
        const third = await auditLog.query({ limit: 2, after: second.nextCursor! });

        expect(first.items.map((e) => e.id)).toEqual(['e-5', 'e-4']);
        expect(second.items.map((e) => e.id)).toEqual(['e-3', 'e-2']);
        expect(third.items.map((e) => e.id)).toEqual(['e-1']);
        expect([first.total, second.total, third.total]).toEqual([5, 5, 5]);
        expect(third.nextCursor).toBeNull();
        expect((await auditLog.query({ limit: 5 })).nextCursor).toBeNull();
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

    describe('concurrency across processes', () => {
      it('never overbooks when two processes book the same resource at once', async () => {
        // Two domain instances on one store behave like two server instances: nothing
        // in-process (a lock, a cache) can protect capacity, only the store can.
        const [first, second] = [domainOn(store), domainOn(store)];
        const lead = await first.crewLeads.register({ username: 'lead', displayName: 'Lead' });
        const crew: Actor = { userId: lead.id, role: Role.CREW_LEAD };
        const pod = await first.resources.provision(crew, {
          name: 'O2 Pod',
          category: 'OXYGEN',
          minTier: 'SILVER',
          capacity: 3,
        });
        const passengers: Actor[] = [];
        for (let i = 0; i < 10; i += 1) {
          const pax = await first.passengers.create(crew, {
            username: `pax${i}`,
            displayName: `Passenger ${i}`,
            tier: 'SILVER',
          });
          passengers.push({ userId: pax.id, role: Role.PASSENGER });
        }
        const start = new Date(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS + HOUR_MS);
        const slot = { resourceId: pod.id, start, end: new Date(start.getTime() + HOUR_MS) };

        const results = await Promise.allSettled(
          passengers.map((actor, i) => (i % 2 ? first : second).bookings.book(actor, slot)),
        );

        const refusals = results.filter((r) => r.status === 'rejected');
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
        for (const refusal of refusals) {
          expect((refusal as PromiseRejectedResult).reason).toMatchObject({
            code: 'CAPACITY_EXCEEDED',
          });
        }
        const stored = await store.repositories.bookings.findByResource(
          pod.id,
          TimeSlot.of(slot.start, slot.end),
        );
        expect(stored.filter((b) => b.occupiesCapacity)).toHaveLength(3);
      });
    });
  });
}
