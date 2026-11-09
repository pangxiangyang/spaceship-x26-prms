import { vi } from 'vitest';
import { ApiClient } from '../../src/api/client';

/**
 * An ApiClient whose server answers GET-style requests from `routes` (by path, read at
 * call time so a test can change an answer later). Sign-in always fails; posts to a path
 * listed in `routes` return that body.
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
    const body = routes[path];
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
