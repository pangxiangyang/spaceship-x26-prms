import { vi } from 'vitest';
import { ApiClient } from '../../src/api/client';

/**
 * An ApiClient whose server answers requests from `routes` (by path, read at call time so
 * a test can change an answer later). An answer may be a function of the request URL, to
 * answer by query string. Sign-in always fails.
 */
export function fakeApi(routes: Record<string, unknown>) {
  const fetchImpl = vi.fn(async (url: string) => {
    const path = url.split('?')[0]!;
    if (path === '/api/auth/login') {
      return new Response(
        JSON.stringify({
          error: { code: 'UNAUTHENTICATED', message: 'Invalid username or password.' },
        }),
        { status: 401 },
      );
    }
    const route = routes[path];
    const body = typeof route === 'function' ? route(new URL(url, 'http://ship.test')) : route;
    return body === undefined
      ? new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'nope' } }), {
          status: 404,
        })
      : new Response(JSON.stringify(body), { status: 200 });
  });
  const client = new ApiClient({
    getToken: () => 'token',
    onUnauthorized: vi.fn(),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return Object.assign(client, { fetchImpl });
}
