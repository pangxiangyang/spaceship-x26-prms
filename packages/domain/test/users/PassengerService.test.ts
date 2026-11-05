import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/shared/errors';
import { at, createTestContext, type TestContext } from '../support/testContext';

describe('PassengerService', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });

  it('lets crew leads create passenger profiles (audited)', async () => {
    const { passenger } = await ctx.addPassenger('GOLD');
    expect(passenger.tier).toBe('GOLD');
    const { items } = await ctx.domain.audit.list(ctx.crewLead, { action: 'PASSENGER_CREATE' });
    expect(items[0]).toMatchObject({ outcome: 'SUCCESS', subject: { id: passenger.id } });
  });

  it('forbids passengers from creating profiles and audits the attempt', async () => {
    const { actor } = await ctx.addPassenger('PLATINUM');
    await expect(
      ctx.domain.passengers.create(actor, { username: 'sneaky', displayName: 'S', tier: 'GOLD' }),
    ).rejects.toThrow(ForbiddenError);
    const { items } = await ctx.domain.audit.list(ctx.crewLead, { outcome: 'DENIED' });
    expect(items[0]).toMatchObject({
      action: 'PASSENGER_CREATE',
      details: { reason: 'FORBIDDEN' },
    });
  });

  it('rejects usernames already used by anyone, including crew leads', async () => {
    await expect(
      ctx.domain.passengers.create(ctx.crewLead, {
        username: 'Alpha',
        displayName: 'Imposter',
        tier: 'SILVER',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('lets passengers read only their own profile', async () => {
    const a = await ctx.addPassenger('SILVER');
    const b = await ctx.addPassenger('SILVER');
    await expect(ctx.domain.passengers.get(a.actor, a.passenger.id)).resolves.toBe(a.passenger);
    await expect(ctx.domain.passengers.get(a.actor, b.passenger.id)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('returns not found for unknown passengers and for crew lead ids', async () => {
    await expect(ctx.domain.passengers.get(ctx.crewLead, 'missing')).rejects.toThrow(NotFoundError);
    await expect(ctx.domain.passengers.get(ctx.crewLead, ctx.crewLead.userId)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('lists passengers alphabetically for crew leads', async () => {
    await ctx.addPassenger('SILVER');
    await ctx.addPassenger('GOLD');
    const list = await ctx.domain.passengers.list(ctx.crewLead);
    expect(list.map((p) => p.displayName)).toEqual(['Passenger 1', 'Passenger 2']);
  });

  it('renames passengers', async () => {
    const { passenger } = await ctx.addPassenger('SILVER');
    await ctx.domain.passengers.rename(ctx.crewLead, passenger.id, 'Dr. Ada');
    expect(passenger.displayName).toBe('Dr. Ada');
  });

  describe('changeTier', () => {
    it('upgrades without touching bookings', async () => {
      const { passenger, actor } = await ctx.addPassenger('SILVER');
      const pod = await ctx.addResource();
      await ctx.domain.bookings.book(actor, { resourceId: pod.id, start: at(60), end: at(120) });

      const result = await ctx.domain.passengers.changeTier(ctx.crewLead, passenger.id, 'GOLD');
      expect(result.change.direction).toBe('UPGRADE');
      expect(result.revokedBookingIds).toEqual([]);
    });

    it('on downgrade, revokes only pending bookings the new tier no longer covers', async () => {
      const { passenger, actor } = await ctx.addPassenger('PLATINUM');
      const pod = await ctx.addResource({ minTier: 'SILVER' });
      const cabin = await ctx.addResource({ name: 'Cabin', category: 'CABIN', minTier: 'GOLD' });
      const deck = await ctx.addResource({
        name: 'VIP Deck',
        category: 'RECREATION',
        minTier: 'PLATINUM',
      });

      const keep = await ctx.domain.bookings.book(actor, {
        resourceId: pod.id,
        start: at(60),
        end: at(90),
      });
      const lose1 = await ctx.domain.bookings.book(actor, {
        resourceId: cabin.id,
        start: at(120),
        end: at(150),
      });
      const lose2 = await ctx.domain.bookings.book(actor, {
        resourceId: deck.id,
        start: at(180),
        end: at(210),
      });

      const result = await ctx.domain.passengers.changeTier(ctx.crewLead, passenger.id, 'SILVER');

      expect(result.change).toEqual({ from: 'PLATINUM', to: 'SILVER', direction: 'DOWNGRADE' });
      expect(result.revokedBookingIds.sort()).toEqual([lose1.id, lose2.id].sort());
      expect(keep.status).toBe('CONFIRMED');
      expect(lose1.cancellationReason).toBe('TIER_DOWNGRADE');

      const audit = await ctx.domain.audit.list(ctx.crewLead, { action: 'TIER_CHANGE' });
      expect(audit.items[0]?.details).toMatchObject({ direction: 'DOWNGRADE', revokedBookings: 2 });
    });

    it('lets an in-progress session finish after a downgrade', async () => {
      const { passenger, actor } = await ctx.addPassenger('GOLD');
      const cabin = await ctx.addResource({ name: 'Cabin', category: 'CABIN', minTier: 'GOLD' });
      const booking = await ctx.domain.bookings.book(actor, {
        resourceId: cabin.id,
        start: at(0),
        end: at(60),
      });
      await ctx.domain.bookings.checkIn(actor, booking.id);

      const result = await ctx.domain.passengers.changeTier(ctx.crewLead, passenger.id, 'SILVER');
      expect(result.revokedBookingIds).toEqual([]);
      expect(booking.status).toBe('CHECKED_IN');
    });

    it('is crew lead only', async () => {
      const { passenger, actor } = await ctx.addPassenger('SILVER');
      await expect(
        ctx.domain.passengers.changeTier(actor, passenger.id, 'PLATINUM'),
      ).rejects.toThrow(ForbiddenError);
      expect(passenger.tier).toBe('SILVER');
    });
  });
});
