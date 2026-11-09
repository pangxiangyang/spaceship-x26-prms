import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrmsDomain } from '../../src/createPrmsDomain';
import { TierAccessDeniedError } from '../../src/shared/errors';
import type { PrmsStorage, Transaction } from '../../src/shared/UnitOfWork';
import { FixedClock } from '../support/FixedClock';
import { SequentialIds } from '../support/SequentialIds';
import { NOW, at, createTestContext, type TestContext } from '../support/testContext';

/** The same storage, but every unit of work sees `tx` through `wrap`. */
function withFaults(storage: PrmsStorage, wrap: (tx: Transaction) => Transaction): PrmsStorage {
  return {
    repositories: storage.repositories,
    unitOfWork: { run: (work) => storage.unitOfWork.run((tx) => work(wrap(tx))) },
  };
}

describe('use cases are all-or-nothing', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });

  /** A second domain instance on the same data, whose storage misbehaves. */
  const faultyDomain = (wrap: (tx: Transaction) => Transaction) =>
    createPrmsDomain({
      storage: withFaults(ctx.storage, wrap),
      clock: new FixedClock(NOW),
      ids: new SequentialIds('faulty'),
    });

  it('stores no booking when its audit record cannot be written', async () => {
    const pod = await ctx.addResource();
    const { actor } = await ctx.addPassenger('SILVER');
    const domain = faultyDomain((tx) => ({
      ...tx,
      auditLog: {
        append: async () => {
          throw new Error('audit store unavailable');
        },
      },
    }));

    await expect(
      domain.bookings.book(actor, { resourceId: pod.id, start: at(60), end: at(120) }),
    ).rejects.toThrow('audit store unavailable');
    expect(await ctx.repositories.bookings.findAll()).toEqual([]);
  });

  it('leaves a downgrade undone when a revocation fails partway through', async () => {
    const { passenger, actor } = await ctx.addPassenger('PLATINUM');
    const cabin = await ctx.addResource({ name: 'Cabin', category: 'CABIN', minTier: 'GOLD' });
    for (const start of [60, 120]) {
      await ctx.domain.bookings.book(actor, {
        resourceId: cabin.id,
        start: at(start),
        end: at(start + 30),
      });
    }
    let saves = 0;
    const domain = faultyDomain((tx) => ({
      ...tx,
      bookings: {
        ...tx.bookings,
        findById: (id) => tx.bookings.findById(id),
        findByPassenger: (id, window) => tx.bookings.findByPassenger(id, window),
        findByResource: (id, window) => tx.bookings.findByResource(id, window),
        findOverlapping: (window) => tx.bookings.findOverlapping(window),
        findAll: () => tx.bookings.findAll(),
        save: async (booking) => {
          saves += 1;
          if (saves === 2) throw new Error('storage unavailable');
          return tx.bookings.save(booking);
        },
      },
    }));

    await expect(
      domain.passengers.changeTier(ctx.crewLead, passenger.id, 'SILVER'),
    ).rejects.toThrow('storage unavailable');

    expect((await ctx.stored.user(passenger.id)).toSnapshot().tier).toBe('PLATINUM');
    const bookings = await ctx.repositories.bookings.findByPassenger(passenger.id);
    expect(bookings.map((b) => b.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
  });

  it('keeps the business refusal when its audit record cannot be written', async () => {
    const platinum = await ctx.addResource({ name: 'O2', category: 'OXYGEN', minTier: 'PLATINUM' });
    const { actor } = await ctx.addPassenger('SILVER');
    const onAuditFailure = vi.fn();
    const storageDown = new Error('audit store unavailable');
    const domain = createPrmsDomain({
      storage: withFaults(ctx.storage, (tx) => ({
        ...tx,
        auditLog: {
          append: async () => {
            throw storageDown;
          },
        },
      })),
      clock: new FixedClock(NOW),
      onAuditFailure,
    });

    // The passenger is told why they were refused, not that storage failed.
    await expect(
      domain.bookings.book(actor, { resourceId: platinum.id, start: at(60), end: at(90) }),
    ).rejects.toThrow(TierAccessDeniedError);
    expect(onAuditFailure).toHaveBeenCalledWith(
      storageDown,
      expect.objectContaining({ action: 'BOOKING_CREATE', reason: 'TIER_ACCESS_DENIED' }),
    );
  });
});
