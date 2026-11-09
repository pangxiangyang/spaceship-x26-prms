import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '@prms/domain';
import { createContainer } from '../src/bootstrap/container';
import { OffsetClock } from '../src/bootstrap/OffsetClock';
import { seedDemoData } from '../src/bootstrap/seedDemoData';
import { resetDemoData } from '../src/bootstrap/resetDemoData';
import { createApp } from '../src/http/app';
import { silentLogger } from '../src/http/logger';
import type { Persistence } from '../src/persistence/Persistence';
import { TestClock, testConfig, testPersistence } from './support/testApp';
import request from 'supertest';

const demoConfig = () => testConfig({ seedDemoData: true });

async function counts(persistence: Persistence) {
  const { users, resources, bookings } = persistence.repositories;
  return {
    crewLeads: (await users.findCrewLeads()).length,
    passengers: (await users.findPassengers()).length,
    resources: (await resources.findAll()).length,
    bookings: (await bookings.findAll()).length,
  };
}

describe('start-up against existing data', () => {
  it('restarts on the same storage without duplicating crew leads or demo data', async () => {
    const persistence = testPersistence();
    await createContainer(demoConfig(), { persistence, clock: new TestClock() });
    const first = await counts(persistence);

    await createContainer(demoConfig(), { persistence, clock: new TestClock() });

    expect(first.crewLeads).toBe(3);
    expect(first.resources).toBeGreaterThan(0);
    expect(await counts(persistence)).toEqual(first);
  });

  it('applies a rotated crew lead password on the next start', async () => {
    const persistence = testPersistence();
    await createContainer(testConfig(), { persistence });
    const rotated = testConfig().crewLeads.map((lead) => ({
      ...lead,
      password: 'rotated-secret-1',
    }));
    const container = await createContainer(testConfig({ crewLeads: rotated }), { persistence });

    await expect(container.auth.login('commander', 'crewlead123')).rejects.toThrow();
    await expect(container.auth.login('commander', 'rotated-secret-1')).resolves.toBeDefined();
  });

  it('refuses to start when a configured crew lead username belongs to a passenger', async () => {
    const persistence = testPersistence();
    const container = await createContainer(testConfig(), { persistence });
    const [lead] = await persistence.repositories.users.findCrewLeads();
    await container.auth.createPassengerAccount(
      { userId: lead!.id, role: 'CREW_LEAD' },
      { username: 'impostor', displayName: 'Impostor', tier: 'GOLD', password: 'password123' },
    );
    const crewLeads = testConfig().crewLeads.map((l, i) =>
      i === 0 ? { ...l, username: 'impostor' } : l,
    );

    await expect(createContainer(testConfig({ crewLeads }), { persistence })).rejects.toMatchObject(
      {
        code: 'USERNAME_TAKEN',
      },
    );
  });
});

describe('demo reset', () => {
  it('wipes everything visitors changed and reseeds a fresh demo', async () => {
    const persistence = testPersistence();
    const container = await createContainer(demoConfig(), { persistence, clock: new TestClock() });
    const fresh = await counts(persistence);
    const [lead] = await persistence.repositories.users.findCrewLeads();
    await container.auth.createPassengerAccount(
      { userId: lead!.id, role: 'CREW_LEAD' },
      { username: 'visitor', displayName: 'Visitor', tier: 'GOLD', password: 'password123' },
    );

    await resetDemoData(demoConfig(), { persistence, clock: new TestClock() });

    expect(await counts(persistence)).toEqual(fresh);
    expect(await persistence.repositories.users.findByUsername('visitor')).toBeUndefined();
  });

  it('refuses to wipe storage that is not a demo environment', async () => {
    const persistence = testPersistence();
    await createContainer(testConfig(), { persistence });

    await expect(
      resetDemoData(testConfig({ seedDemoData: false }), { persistence }),
    ).rejects.toThrow(/not a demo environment/);
    expect((await counts(persistence)).crewLeads).toBe(3);
  });

  it('signs out sessions whose account was removed by a reset', async () => {
    const persistence = testPersistence();
    const container = await createContainer(demoConfig(), { persistence, clock: new TestClock() });
    const { token } = await container.auth.login('commander', 'crewlead123');

    await resetDemoData(demoConfig(), { persistence, clock: new TestClock() });

    const res = await request(createApp(container, silentLogger))
      .get('/api/resources')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('demo seed', () => {
  it('records the planned turn-aways as capacity denials', async () => {
    const persistence = testPersistence();
    await createContainer(demoConfig(), { persistence, clock: new TestClock() });

    const denials = await persistence.repositories.auditLog.query({
      action: 'BOOKING_CREATE',
      outcome: 'DENIED',
    });
    expect(denials.items.length).toBeGreaterThan(0);
    expect(denials.items.every((e) => e.details.reason === 'CAPACITY_EXCEEDED')).toBe(true);
  });

  it('fails instead of hiding an unexpected error during a planned turn-away', async () => {
    const persistence = testPersistence();
    const clock = new OffsetClock(new TestClock());
    const container = await createContainer(testConfig(), { persistence, clock });
    const book = container.domain.bookings.book.bind(container.domain.bookings);
    vi.spyOn(container.domain.bookings, 'book').mockImplementation((actor, input) =>
      book(actor, input).catch((error: unknown) => {
        // Storage fails at exactly the moment the seed expects a capacity refusal.
        throw error instanceof ConflictError ? new Error('storage unavailable') : error;
      }),
    );

    await expect(seedDemoData(container, clock)).rejects.toThrow('storage unavailable');
  });
});
