import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TierAccessDeniedError,
} from '../../src/shared/errors';
import { at, createTestContext, type TestContext } from '../support/testContext';

describe('ResourceService', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });

  describe('provisioning', () => {
    it('is restricted to crew leads', async () => {
      const { actor } = await ctx.addPassenger('PLATINUM');
      await expect(
        ctx.domain.resources.provision(actor, {
          name: 'Rogue Pod',
          category: 'SLEEPING_POD',
          minTier: 'SILVER',
          capacity: 1,
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('records the provisioning in the audit trail', async () => {
      const pod = await ctx.addResource({ capacity: 4 });
      const { items } = await ctx.domain.audit.list(ctx.crewLead, { action: 'RESOURCE_PROVISION' });
      expect(items[0]).toMatchObject({ subject: { id: pod.id }, details: { capacity: 4 } });
    });
  });

  describe('passenger discovery', () => {
    it('shows each tier exactly what it is entitled to, ordered by tier', async () => {
      await ctx.addResource({ name: 'Food Station', category: 'FOOD_STATION', minTier: 'SILVER' });
      await ctx.addResource({ name: 'Adv. Medical Bay', category: 'MEDICAL', minTier: 'GOLD' });
      await ctx.addResource({ name: 'Luxury O2 Pod', category: 'OXYGEN', minTier: 'PLATINUM' });
      const silver = await ctx.addPassenger('SILVER');
      const gold = await ctx.addPassenger('GOLD');
      const platinum = await ctx.addPassenger('PLATINUM');

      const names = async (actor: typeof silver.actor) =>
        (await ctx.domain.resources.listAccessible(actor)).map((r) => r.name);

      expect(await names(silver.actor)).toEqual(['Food Station']);
      expect(await names(gold.actor)).toEqual(['Food Station', 'Adv. Medical Bay']);
      expect(await names(platinum.actor)).toEqual([
        'Food Station',
        'Adv. Medical Bay',
        'Luxury O2 Pod',
      ]);
    });

    it('hides decommissioned resources from passengers but not from crew leads', async () => {
      const pod = await ctx.addResource();
      await ctx.domain.resources.decommission(ctx.crewLead, pod.id);
      const { actor } = await ctx.addPassenger('PLATINUM');
      expect(await ctx.domain.resources.listAccessible(actor)).toEqual([]);
      await expect(ctx.domain.resources.get(actor, pod.id)).rejects.toThrow(NotFoundError);
      expect(await ctx.domain.resources.listAll(ctx.crewLead)).toHaveLength(1);
    });

    it('explains why a resource above the passenger tier cannot be viewed', async () => {
      const deck = await ctx.addResource({
        name: 'VIP Rec Deck',
        category: 'RECREATION',
        minTier: 'PLATINUM',
      });
      const { actor } = await ctx.addPassenger('GOLD');
      await expect(ctx.domain.resources.get(actor, deck.id)).rejects.toThrow(TierAccessDeniedError);
    });
  });

  describe('update', () => {
    it('refuses to shrink capacity below what upcoming bookings need', async () => {
      const station = await ctx.addResource({
        name: 'Station',
        category: 'FOOD_STATION',
        capacity: 3,
      });
      const a = await ctx.addPassenger('SILVER');
      const b = await ctx.addPassenger('SILVER');
      await ctx.domain.bookings.book(a.actor, {
        resourceId: station.id,
        start: at(60),
        end: at(120),
      });
      await ctx.domain.bookings.book(b.actor, {
        resourceId: station.id,
        start: at(90),
        end: at(150),
      });

      await expect(
        ctx.domain.resources.update(ctx.crewLead, station.id, { capacity: 1 }),
      ).rejects.toThrow(expect.objectContaining({ code: 'CAPACITY_EXCEEDED' }));
      expect((await ctx.stored.resource(station.id)).capacity).toBe(3);

      await ctx.domain.resources.update(ctx.crewLead, station.id, { capacity: 2 });
      expect((await ctx.stored.resource(station.id)).capacity).toBe(2);
    });

    it('ignores past bookings when shrinking capacity', async () => {
      const station = await ctx.addResource({ capacity: 2 });
      const a = await ctx.addPassenger('SILVER');
      const b = await ctx.addPassenger('SILVER');
      await ctx.domain.bookings.book(a.actor, {
        resourceId: station.id,
        start: at(30),
        end: at(60),
      });
      await ctx.domain.bookings.book(b.actor, {
        resourceId: station.id,
        start: at(30),
        end: at(60),
      });
      ctx.clock.advanceMinutes(61);

      await expect(
        ctx.domain.resources.update(ctx.crewLead, station.id, { capacity: 1 }),
      ).resolves.toMatchObject({ resource: { capacity: 1 } });
    });

    it('raising the minimum tier revokes bookings of passengers who lose access', async () => {
      const pod = await ctx.addResource({ capacity: 5 });
      const silver = await ctx.addPassenger('SILVER');
      const gold = await ctx.addPassenger('GOLD');
      const { booking: lost } = await ctx.domain.bookings.book(silver.actor, {
        resourceId: pod.id,
        start: at(60),
        end: at(90),
      });
      const { booking: kept } = await ctx.domain.bookings.book(gold.actor, {
        resourceId: pod.id,
        start: at(60),
        end: at(90),
      });

      const result = await ctx.domain.resources.update(ctx.crewLead, pod.id, { minTier: 'GOLD' });

      expect(result.revokedBookingIds).toEqual([lost.id]);
      expect((await ctx.stored.booking(lost.id)).cancellationReason).toBe('RESOURCE_TIER_RAISED');
      expect((await ctx.stored.booking(kept.id)).status).toBe('CONFIRMED');
    });
  });

  describe('decommission', () => {
    it('revokes pending bookings and blocks new ones', async () => {
      const pod = await ctx.addResource({ capacity: 2 });
      const { actor } = await ctx.addPassenger('SILVER');
      const { booking } = await ctx.domain.bookings.book(actor, {
        resourceId: pod.id,
        start: at(60),
        end: at(90),
      });

      const result = await ctx.domain.resources.decommission(ctx.crewLead, pod.id);

      expect(result.revokedBookingIds).toEqual([booking.id]);
      expect((await ctx.stored.booking(booking.id)).cancellationReason).toBe(
        'RESOURCE_DECOMMISSIONED',
      );
      await expect(
        ctx.domain.bookings.book(actor, { resourceId: pod.id, start: at(120), end: at(150) }),
      ).rejects.toThrow(expect.objectContaining({ code: 'RESOURCE_UNAVAILABLE' }));
    });

    it('cannot decommission twice', async () => {
      const pod = await ctx.addResource();
      await ctx.domain.resources.decommission(ctx.crewLead, pod.id);
      await expect(ctx.domain.resources.decommission(ctx.crewLead, pod.id)).rejects.toThrow(
        ConflictError,
      );
    });
  });
});
