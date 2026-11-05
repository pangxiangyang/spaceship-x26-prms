import { describe, expect, it } from 'vitest';
import { at, createTestApp } from './support/testApp';

describe('admin module (Crew Leads)', () => {
  it('lists exactly three crew leads', async () => {
    const { api, crewToken, auth } = await createTestApp();
    const res = await api.get('/api/admin/crew-leads').set(auth(crewToken)).expect(200);
    expect(res.body.crewLeads).toHaveLength(3);
  });

  it('creates passenger accounts that can sign in', async () => {
    const { api, crewToken, auth, login } = await createTestApp();
    await api
      .post('/api/admin/passengers')
      .set(auth(crewToken))
      .send({ username: 'ada', displayName: 'Ada', tier: 'GOLD', password: 'short' })
      .expect(400);
    await api
      .post('/api/admin/passengers')
      .set(auth(crewToken))
      .send({ username: 'ada', displayName: 'Ada', tier: 'GOLD', password: 'long-enough' })
      .expect(201);
    await expect(login('ada', 'long-enough')).resolves.toEqual(expect.any(String));

    const dup = await api
      .post('/api/admin/passengers')
      .set(auth(crewToken))
      .send({ username: 'ADA', displayName: 'Ada 2', tier: 'GOLD', password: 'long-enough' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('renames passengers and downgrades tiers, revoking now-inaccessible bookings', async () => {
    const { api, crewToken, auth, createPassenger, createResource } = await createTestApp();
    const cabin = await createResource({
      name: 'Private Cabin',
      category: 'CABIN',
      minTier: 'GOLD',
    });
    const pax = await createPassenger('GOLD');
    const booking = await api
      .post('/api/bookings')
      .set(auth(pax.token))
      .send({ resourceId: cabin.id, start: at(60), end: at(120) })
      .expect(201);

    await api
      .patch(`/api/admin/passengers/${pax.id}`)
      .set(auth(crewToken))
      .send({ displayName: 'Dr. Who' })
      .expect(200);
    const res = await api
      .put(`/api/admin/passengers/${pax.id}/tier`)
      .set(auth(crewToken))
      .send({ tier: 'SILVER' })
      .expect(200);

    expect(res.body.passenger).toMatchObject({ displayName: 'Dr. Who', tier: 'SILVER' });
    expect(res.body.change.direction).toBe('DOWNGRADE');
    expect(res.body.revokedBookingIds).toEqual([booking.body.booking.id]);

    const history = await api
      .get(`/api/admin/passengers/${pax.id}/history`)
      .set(auth(crewToken))
      .expect(200);
    expect(history.body.entries[0]).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'TIER_DOWNGRADE',
    });
  });

  it('provisions, edits and decommissions resources', async () => {
    const { api, crewToken, auth, createResource } = await createTestApp();
    const invalid = await api
      .post('/api/admin/resources')
      .set(auth(crewToken))
      .send({ name: 'X', category: 'SPA', minTier: 'GOLD', capacity: 1 });
    expect(invalid.status).toBe(400);

    const pod = await createResource({ capacity: 2 });
    const edited = await api
      .patch(`/api/admin/resources/${pod.id}`)
      .set(auth(crewToken))
      .send({ capacity: 5, minTier: 'GOLD' })
      .expect(200);
    expect(edited.body.resource).toMatchObject({ capacity: 5, minTier: 'GOLD' });

    await api.patch(`/api/admin/resources/${pod.id}`).set(auth(crewToken)).send({}).expect(400);

    const decommissioned = await api
      .post(`/api/admin/resources/${pod.id}/decommission`)
      .set(auth(crewToken))
      .expect(200);
    expect(decommissioned.body.resource.status).toBe('DECOMMISSIONED');
    await api.post(`/api/admin/resources/${pod.id}/decommission`).set(auth(crewToken)).expect(409);

    const all = await api.get('/api/admin/resources').set(auth(crewToken)).expect(200);
    expect(all.body.resources).toHaveLength(1);
  });

  it('exposes a filterable audit trail with actor names', async () => {
    const { api, crewToken, auth, createPassenger, createResource } = await createTestApp();
    const o2 = await createResource({
      name: 'Luxury O2 Pod',
      category: 'OXYGEN',
      minTier: 'PLATINUM',
    });
    const pax = await createPassenger('SILVER');
    await api
      .post('/api/bookings')
      .set(auth(pax.token))
      .send({ resourceId: o2.id, start: at(60), end: at(90) })
      .expect(403);

    const res = await api
      .get('/api/admin/audit')
      .query({ action: 'BOOKING_CREATE', outcome: 'DENIED' })
      .set(auth(crewToken))
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.events[0]).toMatchObject({
      actor: { userId: pax.id, role: 'PASSENGER', displayName: 'Passenger 1' },
      subject: { type: 'RESOURCE', id: o2.id },
      details: { reason: 'TIER_ACCESS_DENIED' },
    });

    await api
      .get('/api/admin/audit')
      .query({ action: 'NOT_AN_ACTION' })
      .set(auth(crewToken))
      .expect(400);
  });

  it('serves tier usage and resource demand reports for a period', async () => {
    const { api, clock, crewToken, auth, createPassenger, createResource } = await createTestApp();
    const pod = await createResource({ capacity: 1 });
    const a = await createPassenger('SILVER');
    const b = await createPassenger('GOLD');
    await api
      .post('/api/bookings')
      .set(auth(a.token))
      .send({ resourceId: pod.id, start: at(0), end: at(60) })
      .expect(201);
    await api
      .post('/api/bookings')
      .set(auth(b.token))
      .send({ resourceId: pod.id, start: at(0), end: at(60) })
      .expect(409);
    clock.advanceMinutes(60);

    const tiers = await api.get('/api/admin/reports/tier-usage').set(auth(crewToken)).expect(200);
    expect(tiers.body.tiers.find((t: { tier: string }) => t.tier === 'SILVER')).toMatchObject({
      bookings: 1,
      minutesBooked: 60,
    });

    const demand = await api
      .get('/api/admin/reports/resource-demand')
      .query({ from: at(0), to: at(60) })
      .set(auth(crewToken))
      .expect(200);
    expect(demand.body.period).toEqual({ from: at(0), to: at(60) });
    expect(demand.body.resources[0]).toMatchObject({
      resourceId: pod.id,
      utilization: 1,
      capacityDenials: 1,
      demandLevel: 'HIGH',
    });

    await api
      .get('/api/admin/reports/resource-demand')
      .query({ from: at(60), to: at(0) })
      .set(auth(crewToken))
      .expect(400);
  });
});
