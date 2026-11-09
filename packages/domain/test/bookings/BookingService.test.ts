import { beforeEach, describe, expect, it } from 'vitest';
import { TimeSlot } from '../../src/bookings/TimeSlot';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TierAccessDeniedError,
  ValidationError,
} from '../../src/shared/errors';
import { at, createTestContext, type TestContext } from '../support/testContext';

describe('BookingService', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });

  describe('book — permission validation', () => {
    it('books a resource within the passenger tier', async () => {
      const pod = await ctx.addResource();
      const { passenger, actor } = await ctx.addPassenger('SILVER');
      const { booking, resource } = await ctx.domain.bookings.book(actor, {
        resourceId: pod.id,
        start: at(60),
        end: at(120),
      });
      expect(booking).toMatchObject({
        passengerId: passenger.id,
        resourceId: pod.id,
        status: 'CONFIRMED',
      });
      // The resource as it was checked, so callers can present it without asking again.
      expect(resource).toMatchObject({ id: pod.id, name: pod.name });
    });

    it('lets higher tiers book lower-tier resources', async () => {
      const pod = await ctx.addResource({ minTier: 'SILVER' });
      const { actor } = await ctx.addPassenger('PLATINUM');
      await expect(
        ctx.domain.bookings.book(actor, { resourceId: pod.id, start: at(60), end: at(90) }),
      ).resolves.toBeDefined();
    });

    it('denies resources above the passenger tier and audits the denial', async () => {
      const o2 = await ctx.addResource({
        name: 'Luxury O2 Pod',
        category: 'OXYGEN',
        minTier: 'PLATINUM',
      });
      const { actor } = await ctx.addPassenger('GOLD');

      await expect(
        ctx.domain.bookings.book(actor, { resourceId: o2.id, start: at(60), end: at(90) }),
      ).rejects.toThrow(TierAccessDeniedError);

      const { items } = await ctx.domain.audit.list(ctx.crewLead, { action: 'BOOKING_CREATE' });
      expect(items[0]).toMatchObject({
        outcome: 'DENIED',
        actor: { userId: actor.userId },
        subject: { type: 'RESOURCE', id: o2.id },
        details: { reason: 'TIER_ACCESS_DENIED' },
      });
    });

    it('is for passengers only', async () => {
      const pod = await ctx.addResource();
      await expect(
        ctx.domain.bookings.book(ctx.crewLead, { resourceId: pod.id, start: at(60), end: at(90) }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects unknown resources', async () => {
      const { actor } = await ctx.addPassenger('SILVER');
      await expect(
        ctx.domain.bookings.book(actor, { resourceId: 'nope', start: at(60), end: at(90) }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('book — slot rules', () => {
    it.each([
      ['in the past', -30, 30],
      ['shorter than 15 minutes', 60, 70],
      ['longer than 4 hours', 60, 60 + 241],
      ['more than 14 days ahead', 14 * 24 * 60 + 1, 14 * 24 * 60 + 61],
      ['ending before it starts', 90, 60],
    ])('rejects a slot %s', async (_label, startMin, endMin) => {
      const pod = await ctx.addResource();
      const { actor } = await ctx.addPassenger('SILVER');
      await expect(
        ctx.domain.bookings.book(actor, {
          resourceId: pod.id,
          start: at(startMin),
          end: at(endMin),
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects invalid dates', async () => {
      const pod = await ctx.addResource();
      const { actor } = await ctx.addPassenger('SILVER');
      await expect(
        ctx.domain.bookings.book(actor, { resourceId: pod.id, start: new Date('x'), end: at(30) }),
      ).rejects.toThrow(ValidationError);
    });

    it('accepts a slot starting right now and exactly at the policy bounds', async () => {
      const pod = await ctx.addResource({ capacity: 3 });
      const { actor } = await ctx.addPassenger('SILVER');
      await expect(
        ctx.domain.bookings.book(actor, { resourceId: pod.id, start: at(0), end: at(15) }),
      ).resolves.toBeDefined();
      await expect(
        ctx.domain.bookings.book(actor, { resourceId: pod.id, start: at(15), end: at(255) }),
      ).resolves.toBeDefined();
    });
  });

  describe('book — capacity and overlap', () => {
    it('accepts bookings up to capacity and refuses the next one', async () => {
      const station = await ctx.addResource({
        name: 'Food Station',
        category: 'FOOD_STATION',
        capacity: 2,
      });
      const [a, b, c] = [
        await ctx.addPassenger('SILVER'),
        await ctx.addPassenger('SILVER'),
        await ctx.addPassenger('SILVER'),
      ];
      const slot = { resourceId: station.id, start: at(60), end: at(120) };

      await ctx.domain.bookings.book(a!.actor, slot);
      await ctx.domain.bookings.book(b!.actor, slot);
      await expect(ctx.domain.bookings.book(c!.actor, slot)).rejects.toThrow(
        expect.objectContaining({ code: 'CAPACITY_EXCEEDED' }),
      );
    });

    it('allows back-to-back bookings and bookings spanning sequential ones', async () => {
      const pod = await ctx.addResource({ capacity: 2 });
      const [a, b, c] = [
        await ctx.addPassenger('SILVER'),
        await ctx.addPassenger('SILVER'),
        await ctx.addPassenger('SILVER'),
      ];
      await ctx.domain.bookings.book(a!.actor, { resourceId: pod.id, start: at(60), end: at(120) });
      await ctx.domain.bookings.book(b!.actor, {
        resourceId: pod.id,
        start: at(120),
        end: at(180),
      });
      // At any instant only one seat is taken, so a capacity-2 pod still fits this.
      await expect(
        ctx.domain.bookings.book(c!.actor, { resourceId: pod.id, start: at(60), end: at(180) }),
      ).resolves.toBeDefined();
    });

    it('frees capacity when a booking is cancelled', async () => {
      const pod = await ctx.addResource({ capacity: 1 });
      const a = await ctx.addPassenger('SILVER');
      const b = await ctx.addPassenger('SILVER');
      const slot = { resourceId: pod.id, start: at(60), end: at(120) };
      const { booking: first } = await ctx.domain.bookings.book(a.actor, slot);
      await ctx.domain.bookings.cancel(a.actor, first.id);
      await expect(ctx.domain.bookings.book(b.actor, slot)).resolves.toBeDefined();
    });

    it('stops a passenger double-booking themselves across resources', async () => {
      const pod = await ctx.addResource({ capacity: 5 });
      const gym = await ctx.addResource({
        name: 'Fitness Center',
        category: 'FITNESS',
        capacity: 5,
      });
      const { actor } = await ctx.addPassenger('SILVER');
      await ctx.domain.bookings.book(actor, { resourceId: pod.id, start: at(60), end: at(120) });
      await expect(
        ctx.domain.bookings.book(actor, { resourceId: gym.id, start: at(90), end: at(150) }),
      ).rejects.toThrow(expect.objectContaining({ code: 'BOOKING_OVERLAP' }));
    });

    it('never overbooks under concurrent requests', async () => {
      const pod = await ctx.addResource({ capacity: 3 });
      const passengers = await Promise.all(
        Array.from({ length: 10 }, () => ctx.addPassenger('SILVER')),
      );
      const results = await Promise.allSettled(
        passengers.map(({ actor }) =>
          ctx.domain.bookings.book(actor, { resourceId: pod.id, start: at(60), end: at(120) }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      const stored = await ctx.repositories.bookings.findByResource(pod.id);
      expect(stored.filter((b) => b.occupiesCapacity)).toHaveLength(3);
    });
  });

  describe('cancel', () => {
    it('lets a passenger cancel their own booking but not someone else’s', async () => {
      const pod = await ctx.addResource({ capacity: 2 });
      const a = await ctx.addPassenger('SILVER');
      const b = await ctx.addPassenger('SILVER');
      const { booking } = await ctx.domain.bookings.book(a.actor, {
        resourceId: pod.id,
        start: at(60),
        end: at(90),
      });

      await expect(ctx.domain.bookings.cancel(b.actor, booking.id)).rejects.toThrow(ForbiddenError);
      const cancelled = await ctx.domain.bookings.cancel(a.actor, booking.id);
      expect(cancelled.cancellationReason).toBe('PASSENGER_REQUEST');
    });

    it('lets crew leads cancel any booking', async () => {
      const pod = await ctx.addResource();
      const { actor } = await ctx.addPassenger('SILVER');
      const { booking } = await ctx.domain.bookings.book(actor, {
        resourceId: pod.id,
        start: at(60),
        end: at(90),
      });
      const cancelled = await ctx.domain.bookings.cancel(ctx.crewLead, booking.id);
      expect(cancelled.cancellationReason).toBe('CREW_LEAD_REQUEST');
    });

    it('rejects unknown bookings', async () => {
      const { actor } = await ctx.addPassenger('SILVER');
      await expect(ctx.domain.bookings.cancel(actor, 'nope')).rejects.toThrow(NotFoundError);
    });
  });

  describe('checkIn — real-time validation', () => {
    it('starts usage inside the check-in window and audits it', async () => {
      const pod = await ctx.addResource();
      const { actor } = await ctx.addPassenger('SILVER');
      const { booking } = await ctx.domain.bookings.book(actor, {
        resourceId: pod.id,
        start: at(30),
        end: at(90),
      });

      await expect(ctx.domain.bookings.checkIn(actor, booking.id)).rejects.toThrow(ConflictError);
      ctx.clock.advanceMinutes(15);
      const used = await ctx.domain.bookings.checkIn(actor, booking.id);
      expect(used.status).toBe('CHECKED_IN');

      const { items } = await ctx.domain.audit.list(ctx.crewLead, { action: 'USAGE_START' });
      expect(items.map((e) => e.outcome)).toEqual(['SUCCESS', 'DENIED']);
    });

    it('re-checks the tier at the moment of use', async () => {
      const cabin = await ctx.addResource({
        name: 'Cabin',
        category: 'CABIN',
        minTier: 'GOLD',
        capacity: 2,
      });
      const { passenger, actor } = await ctx.addPassenger('GOLD');
      const { booking } = await ctx.domain.bookings.book(actor, {
        resourceId: cabin.id,
        start: at(0),
        end: at(60),
      });
      // Simulate entitlement changing without going through the revoking service.
      passenger.changeTier('SILVER');
      await ctx.repositories.users.save(passenger);

      await expect(ctx.domain.bookings.checkIn(actor, booking.id)).rejects.toThrow(
        TierAccessDeniedError,
      );
    });

    it('is refused for other passengers’ bookings', async () => {
      const pod = await ctx.addResource();
      const a = await ctx.addPassenger('SILVER');
      const b = await ctx.addPassenger('SILVER');
      const { booking } = await ctx.domain.bookings.book(a.actor, {
        resourceId: pod.id,
        start: at(0),
        end: at(30),
      });
      await expect(ctx.domain.bookings.checkIn(b.actor, booking.id)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe('listing and occupancy', () => {
    it('lists a passenger’s bookings newest first', async () => {
      const pod = await ctx.addResource({ capacity: 3 });
      const { passenger, actor } = await ctx.addPassenger('SILVER');
      const { booking: early } = await ctx.domain.bookings.book(actor, {
        resourceId: pod.id,
        start: at(60),
        end: at(90),
      });
      const { booking: late } = await ctx.domain.bookings.book(actor, {
        resourceId: pod.id,
        start: at(120),
        end: at(150),
      });
      const list = await ctx.domain.bookings.listForPassenger(actor, passenger.id);
      expect(list.map((b) => b.id)).toEqual([late.id, early.id]);
    });

    it('does not let passengers list other passengers’ bookings', async () => {
      const a = await ctx.addPassenger('SILVER');
      const b = await ctx.addPassenger('SILVER');
      await expect(ctx.domain.bookings.listForPassenger(a.actor, b.passenger.id)).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('reports occupied slots in a window without exposing who booked them', async () => {
      const pod = await ctx.addResource({ capacity: 2 });
      const a = await ctx.addPassenger('SILVER');
      const b = await ctx.addPassenger('SILVER');
      await ctx.domain.bookings.book(a.actor, { resourceId: pod.id, start: at(60), end: at(90) });
      const { booking: cancelled } = await ctx.domain.bookings.book(b.actor, {
        resourceId: pod.id,
        start: at(60),
        end: at(90),
      });
      await ctx.domain.bookings.cancel(b.actor, cancelled.id);
      await ctx.domain.bookings.book(b.actor, { resourceId: pod.id, start: at(600), end: at(630) });

      const occupancy = await ctx.domain.bookings.occupancy(
        a.actor,
        pod.id,
        TimeSlot.of(at(0), at(300)),
      );
      expect(occupancy.occupied).toHaveLength(1);
      expect(occupancy.occupied[0]).toBeInstanceOf(TimeSlot);
      expect(Object.keys(occupancy.occupied[0]!)).not.toContain('passengerId');
    });
  });
});
