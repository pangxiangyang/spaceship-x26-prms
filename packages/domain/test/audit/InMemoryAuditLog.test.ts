import { describe, expect, it } from 'vitest';
import { createInMemoryStorage } from '../../src/adapters/in-memory';
import { AuditTrail } from '../../src/audit/AuditTrail';
import { AuditService } from '../../src/audit/AuditService';
import { Role } from '../../src/identity/Actor';
import { ForbiddenError, ValidationError } from '../../src/shared/errors';
import { FixedClock } from '../support/FixedClock';
import { SequentialIds } from '../support/SequentialIds';

const crewLead = { userId: 'crew-1', role: Role.CREW_LEAD };
const passenger = { userId: 'pax-1', role: Role.PASSENGER };

const setup = async () => {
  const clock = new FixedClock('2026-03-01T00:00:00Z');
  const storage = createInMemoryStorage();
  const log = storage.repositories.auditLog;
  const trail = new AuditTrail(storage.unitOfWork, clock, new SequentialIds('evt'));
  await trail.record({
    actor: passenger,
    action: 'BOOKING_CREATE',
    subject: { type: 'RESOURCE', id: 'res-1' },
  });
  clock.advanceMinutes(5);
  await trail.record({
    actor: crewLead,
    action: 'TIER_CHANGE',
    subject: { type: 'PASSENGER', id: 'pax-1' },
    details: { from: 'SILVER', to: 'GOLD' },
  });
  clock.advanceMinutes(5);
  await trail.record({
    actor: passenger,
    action: 'BOOKING_CREATE',
    outcome: 'DENIED',
    subject: { type: 'RESOURCE', id: 'res-2' },
  });
  return { storage, log, service: new AuditService(log) };
};

describe('audit log', () => {
  it('returns events newest first with a total count', async () => {
    const { service } = await setup();
    const page = await service.list(crewLead, {});
    expect(page.total).toBe(3);
    expect(page.items.map((e) => e.id)).toEqual(['evt-3', 'evt-2', 'evt-1']);
  });

  it('filters by action, outcome, actor and subject', async () => {
    const { service } = await setup();
    expect((await service.list(crewLead, { action: 'BOOKING_CREATE' })).total).toBe(2);
    expect((await service.list(crewLead, { outcome: 'DENIED' })).items[0]?.id).toBe('evt-3');
    expect((await service.list(crewLead, { actorId: 'crew-1' })).total).toBe(1);
    expect((await service.list(crewLead, { subjectId: 'pax-1' })).total).toBe(1);
  });

  it('filters by time range and paginates', async () => {
    const { service } = await setup();
    const ranged = await service.list(crewLead, {
      from: new Date('2026-03-01T00:04:00Z'),
      to: new Date('2026-03-01T00:06:00Z'),
    });
    expect(ranged.items.map((e) => e.id)).toEqual(['evt-2']);

    const first = await service.list(crewLead, { limit: 1 });
    const page = await service.list(crewLead, { limit: 1, after: first.nextCursor! });
    expect(page.items.map((e) => e.id)).toEqual(['evt-2']);
    expect(page.total).toBe(3);
  });

  it('refuses a malformed page cursor', async () => {
    const { service } = await setup();
    await expect(service.list(crewLead, { after: 'page-2' })).rejects.toThrow(ValidationError);
  });

  it('stores immutable events', async () => {
    const { log } = await setup();
    const [event] = (await log.query({ limit: 1 })).items;
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event?.details)).toBe(true);
  });

  it('is visible to crew leads only', async () => {
    const { service } = await setup();
    await expect(service.list(passenger, {})).rejects.toThrow(ForbiddenError);
  });
});

describe('in-memory adapters', () => {
  it('can be cleared for a demo reset', async () => {
    const { storage, log } = await setup();
    storage.clear();
    expect((await log.query({})).total).toBe(0);
  });
});
