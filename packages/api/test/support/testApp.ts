import request from 'supertest';
import { afterAll } from 'vitest';
import type { Clock } from '@prms/domain';
import { createContainer } from '../../src/bootstrap/container';
import { DEMO_CREW_LEADS, type AppConfig } from '../../src/config';
import { createApp } from '../../src/http/app';
import { silentLogger } from '../../src/http/logger';
import { createMemoryPersistence } from '../../src/persistence/memoryPersistence';
import type { Persistence } from '../../src/persistence/Persistence';
import { createFirestoreTestPersistence } from './firestoreTarget';

/**
 * Storage for API tests. In-memory by default; `PRMS_TEST_STORAGE=firestore`
 * runs the same suite against Firestore (emulator or a real project).
 */
const opened: Persistence[] = [];

export function testPersistence(): Persistence {
  const persistence =
    process.env.PRMS_TEST_STORAGE === 'firestore'
      ? createFirestoreTestPersistence()
      : createMemoryPersistence();
  opened.push(persistence);
  return persistence;
}

afterAll(async () => {
  for (const persistence of opened.splice(0)) {
    await persistence.wipe();
    await persistence.close();
  }
});

export const NOW = new Date('2026-03-01T08:00:00.000Z');
export const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

export class TestClock implements Clock {
  constructor(private current: Date = NOW) {}
  now = () => new Date(this.current);
  advanceMinutes(minutes: number) {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    env: 'test',
    port: 0,
    jwtSecret: 'test-secret-that-is-long-enough-for-hs256-signing',
    tokenTtlSeconds: 3600,
    bcryptCost: 4,
    seedDemoData: false,
    crewLeads: DEMO_CREW_LEADS,
    webDistDir: undefined,
    loginRateLimit: { windowMs: 60_000, max: 1000 },
    storage: { kind: 'memory' },
    trustProxy: 0,
    ...overrides,
  };
}

export async function createTestApp(configOverrides: Partial<AppConfig> = {}) {
  const clock = new TestClock();
  const container = await createContainer(testConfig(configOverrides), {
    clock,
    persistence: testPersistence(),
  });
  const app = createApp(container, silentLogger);
  const api = request(app);

  const login = async (username: string, password: string) => {
    const res = await api.post('/api/auth/login').send({ username, password }).expect(200);
    return res.body.token as string;
  };
  const crewToken = await login('commander', 'crewlead123');

  let count = 0;
  const createPassenger = async (tier: 'SILVER' | 'GOLD' | 'PLATINUM') => {
    count += 1;
    const username = `pax${count}`;
    const res = await api
      .post('/api/admin/passengers')
      .set('Authorization', `Bearer ${crewToken}`)
      .send({ username, displayName: `Passenger ${count}`, tier, password: 'passenger123' })
      .expect(201);
    return { id: res.body.passenger.id as string, token: await login(username, 'passenger123') };
  };

  const createResource = async (body: Record<string, unknown> = {}) => {
    const res = await api
      .post('/api/admin/resources')
      .set('Authorization', `Bearer ${crewToken}`)
      .send({
        name: 'Sleeping Pod',
        category: 'SLEEPING_POD',
        minTier: 'SILVER',
        capacity: 1,
        ...body,
      })
      .expect(201);
    return res.body.resource as { id: string; name: string };
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  return { api, app, container, clock, crewToken, login, createPassenger, createResource, auth };
}
