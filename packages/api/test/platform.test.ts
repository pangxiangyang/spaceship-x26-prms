import { describe, expect, it } from 'vitest';
import { createContainer } from '../src/bootstrap/container';
import { ConfigError, loadConfig } from '../src/config';
import { createTestApp, testConfig } from './support/testApp';

describe('platform concerns', () => {
  it('reports health and reference data without authentication', async () => {
    const { api } = await createTestApp();
    await api.get('/api/health').expect(200, { status: 'ok', time: '2026-03-01T08:00:00.000Z' });
    const meta = await api.get('/api/meta').expect(200);
    expect(meta.body.tiers).toEqual(['SILVER', 'GOLD', 'PLATINUM']);
    expect(meta.body.bookingPolicy.maxDurationMinutes).toBe(240);
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
    expect(o2).toMatchObject({ demandLevel: 'HIGH' });
    expect(o2.capacityDenials).toBeGreaterThan(0);
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
      });
      expect(config).toMatchObject({ env: 'production', seedDemoData: false });
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
