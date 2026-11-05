import { beforeEach, describe, expect, it } from 'vitest';
import { CrewLeadService, REQUIRED_CREW_LEAD_COUNT } from '../../src/users/CrewLeadService';
import { InMemoryUserRepository } from '../../src/adapters/in-memory/InMemoryUserRepository';
import { InMemoryAuditLog } from '../../src/adapters/in-memory/InMemoryAuditLog';
import { AuditTrail } from '../../src/audit/AuditTrail';
import { Role } from '../../src/identity/Actor';
import { ConflictError, CrewRosterError, ForbiddenError } from '../../src/shared/errors';
import { FixedClock } from '../support/FixedClock';
import { SequentialIds } from '../support/SequentialIds';

describe('CrewLeadService', () => {
  let auditLog: InMemoryAuditLog;
  let service: CrewLeadService;

  beforeEach(() => {
    const clock = new FixedClock('2026-03-01T00:00:00Z');
    const ids = new SequentialIds('crew');
    auditLog = new InMemoryAuditLog();
    service = new CrewLeadService(
      new InMemoryUserRepository(),
      new AuditTrail(auditLog, clock, new SequentialIds('audit')),
      ids,
      clock,
    );
  });

  const registerThree = async () => {
    for (const name of ['alpha', 'bravo', 'charlie']) {
      await service.register({ username: name, displayName: `Lead ${name}` });
    }
  };

  it('requires exactly three crew leads', () => {
    expect(REQUIRED_CREW_LEAD_COUNT).toBe(3);
  });

  it('registers up to three crew leads', async () => {
    await registerThree();
    const lead = { userId: 'crew-1', role: Role.CREW_LEAD };
    expect((await service.list(lead)).map((l) => l.username)).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ]);
  });

  it('refuses a fourth crew lead and audits the denied attempt', async () => {
    await registerThree();
    await expect(
      service.register({ username: 'delta', displayName: 'Lead delta' }),
    ).rejects.toThrow(expect.objectContaining({ code: 'CREW_LEAD_LIMIT_REACHED' }));

    const { items } = await auditLog.query({ action: 'CREW_LEAD_REGISTER', outcome: 'DENIED' });
    expect(items).toHaveLength(1);
    expect(items[0]?.details).toMatchObject({
      username: 'delta',
      reason: 'CREW_LEAD_LIMIT_REACHED',
    });
  });

  it('refuses even when four registrations race each other', async () => {
    const attempts = await Promise.allSettled(
      ['a1x', 'b2x', 'c3x', 'd4x'].map((u) => service.register({ username: u, displayName: u })),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(3);
    expect(attempts.filter((a) => a.status === 'rejected')).toHaveLength(1);
  });

  it('rejects duplicate usernames', async () => {
    await service.register({ username: 'alpha', displayName: 'Lead' });
    await expect(service.register({ username: 'ALPHA', displayName: 'Other' })).rejects.toThrow(
      ConflictError,
    );
  });

  it('reports an incomplete roster', async () => {
    await service.register({ username: 'alpha', displayName: 'Lead' });
    await expect(service.assertRosterComplete()).rejects.toThrow(CrewRosterError);
    await service.register({ username: 'bravo', displayName: 'Lead' });
    await service.register({ username: 'charlie', displayName: 'Lead' });
    await expect(service.assertRosterComplete()).resolves.toBeUndefined();
  });

  it('only lets crew leads view the roster', async () => {
    await expect(service.list({ userId: 'p', role: Role.PASSENGER })).rejects.toThrow(
      ForbiddenError,
    );
  });
});
