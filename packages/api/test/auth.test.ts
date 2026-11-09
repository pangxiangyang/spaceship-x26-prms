import { describe, expect, it, vi } from 'vitest';
import { Role } from '@prms/domain';
import { createContainer } from '../src/bootstrap/container';
import { createTestApp, testConfig, testPersistence } from './support/testApp';

describe('authentication', () => {
  it('issues a token and profile on valid credentials', async () => {
    const { api } = await createTestApp();
    const res = await api
      .post('/api/auth/login')
      .send({ username: 'commander', password: 'crewlead123' })
      .expect(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ username: 'commander', role: 'CREW_LEAD', tier: null });
  });

  it('gives the same answer for an unknown user and a wrong password', async () => {
    const { api } = await createTestApp();
    const wrong = await api
      .post('/api/auth/login')
      .send({ username: 'commander', password: 'nope' });
    const unknown = await api.post('/api/auth/login').send({ username: 'ghost', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('reads the same stored data for an unknown user as for a wrong password', async () => {
    const persistence = testPersistence();
    const { auth } = await createContainer(testConfig(), { persistence });
    const reads = vi.spyOn(persistence.credentials, 'getPasswordHash');

    await expect(auth.login('commander', 'wrong-password')).rejects.toThrow();
    const forKnownUser = reads.mock.calls.length;
    reads.mockClear();
    await expect(auth.login('ghost', 'wrong-password')).rejects.toThrow();

    // Different storage round trips would let response times reveal which usernames exist.
    expect(reads.mock.calls.length).toBe(forKnownUser);
  });

  it('creates no account when its password cannot be stored', async () => {
    const persistence = testPersistence();
    const { auth } = await createContainer(testConfig(), { persistence });
    const lead = await persistence.repositories.users.findByUsername('commander');
    vi.spyOn(persistence, 'credentialsIn').mockReturnValue({
      setPasswordHash: async () => {
        throw new Error('credential store unavailable');
      },
      getPasswordHash: async () => undefined,
    });

    await expect(
      auth.createPassengerAccount(
        { userId: lead!.id, role: Role.CREW_LEAD },
        { username: 'ada', displayName: 'Ada', tier: 'SILVER', password: 'passenger123' },
      ),
    ).rejects.toThrow('credential store unavailable');
    // Otherwise the username would be taken for good by an account nobody can sign in to.
    expect(await persistence.repositories.users.findByUsername('ada')).toBeUndefined();
  });

  it('validates the login payload', async () => {
    const { api } = await createTestApp();
    const res = await api.post('/api/auth/login').send({ username: '' }).expect(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toEqual(
      expect.arrayContaining(['username', 'password']),
    );
  });

  it('rate-limits repeated sign-in attempts', async () => {
    // The test harness signs the commander in once, which counts towards the limit.
    const { api } = await createTestApp({ loginRateLimit: { windowMs: 60_000, max: 3 } });
    for (let i = 0; i < 2; i += 1) {
      await api.post('/api/auth/login').send({ username: 'x', password: 'y' }).expect(401);
    }
    const res = await api
      .post('/api/auth/login')
      .send({ username: 'x', password: 'y' })
      .expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('rejects requests without, or with a tampered, bearer token', async () => {
    const { api, crewToken } = await createTestApp();
    expect((await api.get('/api/me')).status).toBe(401);
    expect((await api.get('/api/me').set('Authorization', crewToken)).status).toBe(401);
    const tampered = `${crewToken.slice(0, -2)}xx`;
    const res = await api.get('/api/me').set('Authorization', `Bearer ${tampered}`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the signed-in user', async () => {
    const { api, createPassenger, auth } = await createTestApp();
    const pax = await createPassenger('GOLD');
    const res = await api.get('/api/me').set(auth(pax.token)).expect(200);
    expect(res.body.user).toMatchObject({ id: pax.id, role: 'PASSENGER', tier: 'GOLD' });
  });
});
