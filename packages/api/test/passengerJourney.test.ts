import { describe, expect, it } from 'vitest';
import { at, createTestApp } from './support/testApp';

describe('passenger journey', () => {
  it('discovers only resources the tier grants', async () => {
    const { api, createResource, createPassenger, auth } = await createTestApp();
    await createResource({ name: 'Food Station', category: 'FOOD_STATION', minTier: 'SILVER' });
    await createResource({ name: 'Private Cabin', category: 'CABIN', minTier: 'GOLD' });
    await createResource({ name: 'VIP Rec Deck', category: 'RECREATION', minTier: 'PLATINUM' });
    const gold = await createPassenger('GOLD');

    const res = await api.get('/api/resources').set(auth(gold.token)).expect(200);
    expect(res.body.resources.map((r: { name: string }) => r.name)).toEqual([
      'Food Station',
      'Private Cabin',
    ]);
  });

  it('books, checks in, and sees the session in their history', async () => {
    const { api, clock, createResource, createPassenger, auth } = await createTestApp();
    const pod = await createResource();
    const pax = await createPassenger('SILVER');

    const created = await api
      .post('/api/bookings')
      .set(auth(pax.token))
      .send({ resourceId: pod.id, start: at(30), end: at(90) })
      .expect(201);
    expect(created.body.booking).toMatchObject({
      resourceName: 'Sleeping Pod',
      status: 'CONFIRMED',
      lifecycle: 'UPCOMING',
      durationMinutes: 60,
      passengerTier: 'SILVER',
    });

    clock.advanceMinutes(30);
    const checkedIn = await api
      .post(`/api/bookings/${created.body.booking.id}/check-in`)
      .set(auth(pax.token))
      .expect(200);
    expect(checkedIn.body.booking).toMatchObject({
      status: 'CHECKED_IN',
      lifecycle: 'IN_PROGRESS',
    });

    const history = await api.get('/api/history').set(auth(pax.token)).expect(200);
    expect(history.body.summary).toMatchObject({
      totalBookings: 1,
      inProgress: 1,
      minutesUsed: 60,
    });
    expect(history.body.entries[0].resourceName).toBe('Sleeping Pod');

    const bookings = await api.get('/api/bookings').set(auth(pax.token)).expect(200);
    expect(bookings.body.bookings).toHaveLength(1);
  });

  it('maps business-rule violations to clear HTTP errors', async () => {
    const { api, createResource, createPassenger, auth } = await createTestApp();
    const pod = await createResource({ capacity: 1 });
    const platinumOnly = await createResource({
      name: 'Luxury O2 Pod',
      category: 'OXYGEN',
      minTier: 'PLATINUM',
    });
    const a = await createPassenger('SILVER');
    const b = await createPassenger('SILVER');
    const slot = { start: at(60), end: at(120) };

    await api
      .post('/api/bookings')
      .set(auth(a.token))
      .send({ resourceId: pod.id, ...slot })
      .expect(201);

    const full = await api
      .post('/api/bookings')
      .set(auth(b.token))
      .send({ resourceId: pod.id, ...slot });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('CAPACITY_EXCEEDED');

    const denied = await api
      .post('/api/bookings')
      .set(auth(b.token))
      .send({ resourceId: platinumOnly.id, ...slot });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatchObject({ code: 'TIER_ACCESS_DENIED' });
    expect(denied.body.error.message).toContain('PLATINUM');

    const past = await api
      .post('/api/bookings')
      .set(auth(b.token))
      .send({ resourceId: pod.id, start: at(-60), end: at(-30) });
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe('VALIDATION_FAILED');

    const malformed = await api
      .post('/api/bookings')
      .set(auth(b.token))
      .send({ resourceId: pod.id, start: 'tomorrow' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_REQUEST');

    const missing = await api
      .post('/api/bookings')
      .set(auth(b.token))
      .send({ resourceId: 'nope', ...slot });
    expect(missing.status).toBe(404);
  });

  it('cancels own bookings but not other passengers’', async () => {
    const { api, createResource, createPassenger, auth } = await createTestApp();
    const pod = await createResource({ capacity: 2 });
    const a = await createPassenger('SILVER');
    const b = await createPassenger('SILVER');
    const booking = await api
      .post('/api/bookings')
      .set(auth(a.token))
      .send({ resourceId: pod.id, start: at(60), end: at(90) });

    await api
      .post(`/api/bookings/${booking.body.booking.id}/cancel`)
      .set(auth(b.token))
      .expect(403);
    const res = await api
      .post(`/api/bookings/${booking.body.booking.id}/cancel`)
      .set(auth(a.token))
      .expect(200);
    expect(res.body.booking).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'PASSENGER_REQUEST',
    });
  });

  it('shows anonymised occupancy for planning', async () => {
    const { api, createResource, createPassenger, auth } = await createTestApp();
    const pod = await createResource({ capacity: 2 });
    const a = await createPassenger('SILVER');
    await api
      .post('/api/bookings')
      .set(auth(a.token))
      .send({ resourceId: pod.id, start: at(60), end: at(90) })
      .expect(201);

    const res = await api
      .get(`/api/resources/${pod.id}/occupancy`)
      .query({ from: at(0), to: at(24 * 60) })
      .set(auth(a.token))
      .expect(200);
    expect(res.body).toEqual({
      resourceId: pod.id,
      capacity: 2,
      occupied: [{ start: at(60), end: at(90) }],
    });

    await api
      .get(`/api/resources/${pod.id}/occupancy`)
      .query({ from: at(0), to: at(8 * 24 * 60) })
      .set(auth(a.token))
      .expect(400);
  });

  it('keeps passengers out of the admin module', async () => {
    const { api, createPassenger, auth } = await createTestApp();
    const pax = await createPassenger('PLATINUM');
    const res = await api.get('/api/admin/passengers').set(auth(pax.token)).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
