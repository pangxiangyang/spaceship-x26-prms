import { beforeEach, describe, expect, it } from 'vitest';
import { TimeSlot } from '../../src/bookings/TimeSlot';
import { ForbiddenError, ValidationError } from '../../src/shared/errors';
import { NOW, at, createTestContext, type TestContext } from '../support/testContext';

const DAY = 24 * 60;

describe('ReportService', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });

  describe('personal history', () => {
    it('summarises a passenger’s consumption by lifecycle, category and day', async () => {
      const pod = await ctx.addResource({ capacity: 5 });
      const gym = await ctx.addResource({ name: 'Gym', category: 'FITNESS', capacity: 5 });
      const { passenger, actor } = await ctx.addPassenger('SILVER');
      const book = (resourceId: string, start: number, end: number) =>
        ctx.domain.bookings.book(actor, { resourceId, start: at(start), end: at(end) });

      const used = await book(pod.id, 0, 60);
      await ctx.domain.bookings.checkIn(actor, used.id);
      await book(gym.id, 120, 150); // will be missed
      const cancelled = await book(gym.id, 200, 230);
      await ctx.domain.bookings.cancel(actor, cancelled.id);
      ctx.clock.advanceMinutes(DAY); // next day
      const gymUsed = await ctx.domain.bookings.book(actor, {
        resourceId: gym.id,
        start: at(DAY),
        end: at(DAY + 45),
      });
      await ctx.domain.bookings.checkIn(actor, gymUsed.id);
      await ctx.domain.bookings.book(actor, {
        resourceId: pod.id,
        start: at(DAY + 300),
        end: at(DAY + 360),
      });

      const history = await ctx.domain.reports.personalHistory(actor, passenger.id);

      expect(history.entries).toHaveLength(5);
      expect(history.entries[0]).toMatchObject({
        resourceName: 'Sleeping Pod A',
        lifecycle: 'UPCOMING',
      });
      expect(history.summary).toMatchObject({
        totalBookings: 5,
        upcoming: 1,
        inProgress: 1,
        completed: 1,
        missed: 1,
        cancelled: 1,
        minutesUsed: 105,
      });
      expect(history.summary.minutesByCategory).toEqual({ SLEEPING_POD: 60, FITNESS: 45 });
      expect(history.summary.dailyUsage).toHaveLength(7);
      expect(history.summary.dailyUsage.slice(-2)).toEqual([
        { date: '2026-03-01', minutes: 60 },
        { date: '2026-03-02', minutes: 45 },
      ]);
    });

    it('is private to the passenger and crew leads', async () => {
      const a = await ctx.addPassenger('SILVER');
      const b = await ctx.addPassenger('SILVER');
      await expect(ctx.domain.reports.personalHistory(a.actor, b.passenger.id)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(
        ctx.domain.reports.personalHistory(ctx.crewLead, b.passenger.id),
      ).resolves.toBeDefined();
    });
  });

  describe('usage by tier', () => {
    it('groups usage by the tier held at booking time', async () => {
      const pod = await ctx.addResource({ capacity: 10 });
      const cabin = await ctx.addResource({
        name: 'Cabin',
        category: 'CABIN',
        minTier: 'GOLD',
        capacity: 10,
      });
      const silver = await ctx.addPassenger('SILVER');
      const gold = await ctx.addPassenger('GOLD');
      await ctx.addPassenger('GOLD');

      const s1 = await ctx.domain.bookings.book(silver.actor, {
        resourceId: pod.id,
        start: at(0),
        end: at(60),
      });
      await ctx.domain.bookings.checkIn(silver.actor, s1.id);
      await ctx.domain.bookings.book(gold.actor, {
        resourceId: cabin.id,
        start: at(60),
        end: at(180),
      });
      await ctx.domain.bookings.book(gold.actor, {
        resourceId: pod.id,
        start: at(200),
        end: at(230),
      });
      // Upgrading later must not rewrite history.
      await ctx.domain.passengers.changeTier(ctx.crewLead, silver.passenger.id, 'PLATINUM');

      const report = await ctx.domain.reports.usageByTier(
        ctx.crewLead,
        TimeSlot.of(at(0), at(DAY)),
      );

      expect(report.map((r) => r.tier)).toEqual(['SILVER', 'GOLD', 'PLATINUM']);
      expect(report[0]).toMatchObject({
        bookings: 1,
        sessionsUsed: 1,
        minutesBooked: 60,
        minutesUsed: 60,
        topCategory: 'SLEEPING_POD',
      });
      expect(report[1]).toMatchObject({
        passengerCount: 2,
        bookings: 2,
        sessionsUsed: 0,
        minutesBooked: 150,
        topCategory: 'CABIN',
      });
      expect(report[2]).toMatchObject({ passengerCount: 1, bookings: 0, topCategory: null });
    });

    it('excludes cancelled bookings and bookings outside the period', async () => {
      const pod = await ctx.addResource({ capacity: 10 });
      const { actor } = await ctx.addPassenger('SILVER');
      const c = await ctx.domain.bookings.book(actor, {
        resourceId: pod.id,
        start: at(0),
        end: at(60),
      });
      await ctx.domain.bookings.cancel(actor, c.id);
      await ctx.domain.bookings.book(actor, {
        resourceId: pod.id,
        start: at(3 * DAY),
        end: at(3 * DAY + 60),
      });

      const [silver] = await ctx.domain.reports.usageByTier(
        ctx.crewLead,
        TimeSlot.of(at(0), at(DAY)),
      );
      expect(silver).toMatchObject({ bookings: 0, minutesBooked: 0 });
    });
  });

  describe('resource demand', () => {
    it('ranks resources by utilisation and flags shortages from turned-away requests', async () => {
      const o2 = await ctx.addResource({
        name: 'Luxury O2 Pod',
        category: 'OXYGEN',
        minTier: 'PLATINUM',
        capacity: 1,
      });
      const gym = await ctx.addResource({ name: 'Gym', category: 'FITNESS', capacity: 4 });
      const idle = await ctx.addResource({ name: 'Hygiene Pod', category: 'HYGIENE', capacity: 2 });
      const p1 = await ctx.addPassenger('PLATINUM');
      const p2 = await ctx.addPassenger('PLATINUM');

      // O2 pod: booked the full 2-hour window, and a second passenger is turned away.
      await ctx.domain.bookings.book(p1.actor, { resourceId: o2.id, start: at(0), end: at(120) });
      await expect(
        ctx.domain.bookings.book(p2.actor, { resourceId: o2.id, start: at(30), end: at(60) }),
      ).rejects.toThrow();
      // Gym: one seat of four for one hour => 1*60 / (4*120) = 12.5%.
      await ctx.domain.bookings.book(p2.actor, { resourceId: gym.id, start: at(60), end: at(120) });

      const report = await ctx.domain.reports.resourceDemand(
        ctx.crewLead,
        TimeSlot.of(at(0), at(120)),
      );

      expect(report.map((r) => r.resourceId)).toEqual([o2.id, gym.id, idle.id]);
      expect(report[0]).toMatchObject({ utilization: 1, capacityDenials: 1, demandLevel: 'HIGH' });
      expect(report[1]).toMatchObject({
        bookings: 1,
        minutesBooked: 60,
        utilization: 0.125,
        demandLevel: 'LOW',
      });
      expect(report[2]).toMatchObject({ bookings: 0, utilization: 0, demandLevel: 'LOW' });
    });

    it('treats any turned-away request as high demand even at low utilisation', async () => {
      const pod = await ctx.addResource({ capacity: 1 });
      const a = await ctx.addPassenger('SILVER');
      const b = await ctx.addPassenger('SILVER');
      await ctx.domain.bookings.book(a.actor, { resourceId: pod.id, start: at(0), end: at(15) });
      await ctx.domain.bookings
        .book(b.actor, { resourceId: pod.id, start: at(0), end: at(15) })
        .catch(() => undefined);

      const [row] = await ctx.domain.reports.resourceDemand(
        ctx.crewLead,
        TimeSlot.of(at(0), at(DAY)),
      );
      expect(row?.utilization).toBeLessThan(0.4);
      expect(row?.demandLevel).toBe('HIGH');
    });

    it('rejects periods longer than 90 days', async () => {
      await expect(
        ctx.domain.reports.resourceDemand(ctx.crewLead, TimeSlot.of(new Date(NOW), at(91 * DAY))),
      ).rejects.toThrow(ValidationError);
    });
  });

  it('keeps ship-wide reports for crew leads only', async () => {
    const { actor } = await ctx.addPassenger('PLATINUM');
    const period = TimeSlot.of(at(0), at(60));
    await expect(ctx.domain.reports.usageByTier(actor, period)).rejects.toThrow(ForbiddenError);
    await expect(ctx.domain.reports.resourceDemand(actor, period)).rejects.toThrow(ForbiddenError);
  });
});
