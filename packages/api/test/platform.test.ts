import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createContainer } from '../src/bootstrap/container';
import { ConfigError, loadConfig } from '../src/config';
import { createApp } from '../src/http/app';
import { silentLogger } from '../src/http/logger';
import { createTestApp, testConfig, testPersistence } from './support/testApp';

describe('platform concerns', () => {
  it('reports health and reference data without authentication', async () => {
    const { api } = await createTestApp();
    await api.get('/api/health').expect(200, { status: 'ok', time: '2026-03-01T08:00:00.000Z' });
    const meta = await api.get('/api/meta').expect(200);
    expect(meta.body.tiers).toEqual(['SILVER', 'GOLD', 'PLATINUM']);
    expect(meta.body.bookingPolicy.maxDurationMinutes).toBe(240);
    expect(meta.body.demo).toBeNull();
  });

  it('reports ready only when storage answers', async () => {
    const { api, container } = await createTestApp();
    await api.get('/api/ready').expect(200, { status: 'ready' });

    vi.spyOn(container.persistence, 'ping').mockRejectedValue(new Error('storage unreachable'));
    const down = await api.get('/api/ready').expect(503);
    expect(down.body.error.code).toBe('NOT_READY');
    // Liveness stays free and independent of storage.
    await api.get('/api/health').expect(200);
  });

  it('publishes the booking policy the domain enforces, not the defaults', async () => {
    const container = await createContainer(testConfig(), {
      persistence: testPersistence(),
      bookingPolicy: { checkInLeadMinutes: 30 },
    });
    const meta = await request(createApp(container, silentLogger)).get('/api/meta').expect(200);
    expect(meta.body.bookingPolicy.checkInLeadMinutes).toBe(30);
  });

  it('publishes demo sign-in details only when running with demo data', async () => {
    const { api } = await createTestApp({ seedDemoData: true });
    const meta = await api.get('/api/meta').expect(200);
    expect(meta.body.demo.accounts).toEqual([
      { label: 'Crew Lead', username: 'commander', password: 'crewlead123' },
      { label: 'Silver passenger', username: 'sam.silver', password: 'passenger123' },
      { label: 'Gold passenger', username: 'gwen.gold', password: 'passenger123' },
      { label: 'Platinum passenger', username: 'pia.platinum', password: 'passenger123' },
    ]);
    for (const { username, password } of meta.body.demo.accounts) {
      await api.post('/api/auth/login').send({ username, password }).expect(200);
    }
  });

  it('rejects a valid token whose account no longer exists', async () => {
    const { api, container } = await createTestApp();
    const { token } = container.tokens.issue({ userId: 'deleted-user', role: 'PASSENGER' });
    const res = await api.get('/api/resources').set('Authorization', `Bearer ${token}`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rate-limits sign-ins per client when behind a trusted proxy', async () => {
    const { api } = await createTestApp({
      trustProxy: 1,
      loginRateLimit: { windowMs: 60_000, max: 3 },
    });
    const attempt = (ip: string) =>
      api.post('/api/auth/login').set('X-Forwarded-For', ip).send({ username: 'x', password: 'y' });

    // The harness's own sign-in came from a different (direct) address.
    for (let i = 0; i < 3; i += 1) expect((await attempt('203.0.113.7')).status).toBe(401);
    expect((await attempt('203.0.113.7')).status).toBe(429);
    expect((await attempt('198.51.100.20')).status).toBe(401);
  });

  it('limits how many changes each signed-in user can make per window', async () => {
    const { api, auth, createPassenger } = await createTestApp({
      writeRateLimit: { windowMs: 60_000, max: 3 },
    });
    const [a, b] = [await createPassenger('SILVER'), await createPassenger('SILVER')];
    const write = (token: string) =>
      api.post('/api/bookings/no-such-booking/cancel').set(auth(token));

    for (let i = 0; i < 3; i += 1) expect((await write(a.token)).status).toBe(404);
    const limited = await write(a.token);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    // Counted per account, not per address: another passenger is unaffected,
    expect((await write(b.token)).status).toBe(404);
    // and reading is never limited.
    expect((await api.get('/api/bookings').set(auth(a.token))).status).toBe(200);
  });

  it('answers malformed JSON and unknown endpoints with JSON errors', async () => {
    const { api, crewToken } = await createTestApp();
    const bad = await api
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"username":')
      .expect(400);
    expect(bad.body.error.code).toBe('INVALID_REQUEST');
    await api.get('/api/nope').set('Authorization', `Bearer ${crewToken}`).expect(404);
  });

  it('sets security headers', async () => {
    const { api } = await createTestApp();
    const res = await api.get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('refuses to start without exactly three crew leads', async () => {
    const two = testConfig().crewLeads.slice(0, 2);
    await expect(createContainer(testConfig({ crewLeads: two }))).rejects.toMatchObject({
      code: 'CREW_ROSTER_INCOMPLETE',
    });
    const four = [
      ...testConfig().crewLeads,
      { username: 'extra', displayName: 'Extra', password: 'password123' },
    ];
    await expect(createContainer(testConfig({ crewLeads: four }))).rejects.toMatchObject({
      code: 'CREW_LEAD_LIMIT_REACHED',
    });
  });

  it('seeds a consistent demo world through the domain rules', async () => {
    const { api, crewToken } = await createTestApp({ seedDemoData: true });
    const demand = await api
      .get('/api/admin/reports/resource-demand')
      .set('Authorization', `Bearer ${crewToken}`)
      .expect(200);
    const o2 = demand.body.resources.find(
      (r: { resourceName: string }) => r.resourceName === 'Luxury O2 Pod',
    );
    expect(o2).toMatchObject({ demandLevel: 'HIGH', demandReason: 'TURNED_AWAY' });
    expect(o2.turnedAwayPassengers).toBeGreaterThanOrEqual(2);
    await api
      .post('/api/auth/login')
      .send({ username: 'pia.platinum', password: 'passenger123' })
      .expect(200);
  });

  describe('loadConfig', () => {
    it('uses safe development defaults', () => {
      const config = loadConfig({});
      expect(config).toMatchObject({ env: 'development', port: 3000, seedDemoData: true });
      expect(config.crewLeads).toHaveLength(3);
    });

    it('requires real secrets in production', () => {
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
      expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) })).toThrow(
        /PRMS_CREW_LEADS/,
      );
    });

    it('accepts a valid production configuration', () => {
      const crew = JSON.stringify(
        ['a', 'b', 'c'].map((u) => ({
          username: `lead.${u}`,
          displayName: u,
          password: 'very-long-password',
        })),
      );
      const config = loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(40),
        PRMS_CREW_LEADS: crew,
        STORAGE: 'firestore',
        TRUST_PROXY: '1',
      });
      expect(config).toMatchObject({
        env: 'production',
        seedDemoData: false,
        trustProxy: 1,
        storage: { kind: 'firestore', databaseId: '(default)', namespace: '' },
      });
      expect(() =>
        loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), PRMS_CREW_LEADS: crew }),
      ).toThrow(/STORAGE is required in production/);
    });

    it('configures storage', () => {
      expect(loadConfig({}).storage).toEqual({ kind: 'memory' });
      expect(loadConfig({}).trustProxy).toBe(0);
      expect(
        loadConfig({
          STORAGE: 'firestore',
          FIRESTORE_PROJECT_ID: 'spaceship-x26-prms',
          FIRESTORE_DATABASE_ID: 'prms',
          FIRESTORE_NAMESPACE: 'staging',
        }).storage,
      ).toEqual({
        kind: 'firestore',
        projectId: 'spaceship-x26-prms',
        databaseId: 'prms',
        namespace: 'staging',
      });
      expect(() => loadConfig({ STORAGE: 'mongo' })).toThrow(ConfigError);
      expect(() =>
        loadConfig({ STORAGE: 'firestore', FIRESTORE_NAMESPACE: 'bad/namespace' }),
      ).toThrow(ConfigError);
    });

    it('rejects a crew roster that is not exactly three', () => {
      const crew = JSON.stringify([
        { username: 'solo', displayName: 'Solo', password: 'very-long-password' },
      ]);
      expect(() => loadConfig({ PRMS_CREW_LEADS: crew })).toThrow(/exactly three/);
      expect(() => loadConfig({ PRMS_CREW_LEADS: '{not json' })).toThrow(/valid JSON/);
    });
  });
});
