import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../src/api/client';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ApiClient', () => {
  it('sends the bearer token, JSON body and query string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = new ApiClient({ getToken: () => 'abc', onUnauthorized: vi.fn(), fetchImpl });

    await client.post('/api/bookings', { resourceId: 'r1' });
    await client.get('/api/admin/audit', { action: 'TIER_CHANGE', outcome: '', limit: 50 });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/bookings');
    expect(init.headers.Authorization).toBe('Bearer abc');
    expect(init.body).toBe('{"resourceId":"r1"}');
    expect(fetchImpl.mock.calls[1]![0]).toBe('/api/admin/audit?action=TIER_CHANGE&limit=50');
  });

  it('turns error envelopes into ApiError with code and issues', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(409, { error: { code: 'CAPACITY_EXCEEDED', message: 'Fully booked.' } }),
      );
    const client = new ApiClient({ getToken: () => 't', onUnauthorized: vi.fn(), fetchImpl });
    const error = await client.post('/api/bookings', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'CAPACITY_EXCEEDED',
      message: 'Fully booked.',
    });
  });

  it('signals an expired session on 401 when a token was sent', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Expired' } }),
      );
    await new ApiClient({ getToken: () => 't', onUnauthorized, fetchImpl })
      .get('/api/me')
      .catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledOnce();

    const anonymous = vi.fn();
    await new ApiClient({ getToken: () => null, onUnauthorized: anonymous, fetchImpl })
      .get('/api/me')
      .catch(() => undefined);
    expect(anonymous).not.toHaveBeenCalled();
  });

  it('reports network failures distinctly', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const client = new ApiClient({ getToken: () => null, onUnauthorized: vi.fn(), fetchImpl });
    await expect(client.get('/api/health')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });
});
