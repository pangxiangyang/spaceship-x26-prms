import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api/client';
import type { Resource, User } from '../src/api/types';
import { App } from '../src/App';
import { AuthProvider } from '../src/auth/AuthContext';

const passenger: User = {
  id: 'p1',
  username: 'gwen.gold',
  displayName: 'Gwen Alvarez',
  role: 'PASSENGER',
  tier: 'GOLD',
  createdAt: '2026-03-01T00:00:00Z',
};
const crewLead: User = {
  ...passenger,
  id: 'c1',
  username: 'commander',
  displayName: 'Cmdr. Ava Reyes',
  role: 'CREW_LEAD',
  tier: null,
};

const cabin: Resource = {
  id: 'r1',
  name: 'Private Cabin',
  description: 'Quiet quarters',
  category: 'CABIN',
  minTier: 'GOLD',
  capacity: 4,
  status: 'ACTIVE',
  createdAt: '2026-03-01T00:00:00Z',
  decommissionedAt: null,
};

function fakeApi(routes: Record<string, unknown>) {
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
  return new ApiClient({
    getToken: () => 'token',
    onUnauthorized: vi.fn(),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

function renderApp(path: string, user: User | null, routes: Record<string, unknown> = {}) {
  sessionStorage.clear();
  if (user) sessionStorage.setItem('prms.session', JSON.stringify({ token: 'token', user }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider client={fakeApi(routes)}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('App', () => {
  beforeEach(() => sessionStorage.clear());

  it('sends signed-out visitors to the login page and shows sign-in errors', async () => {
    renderApp('/resources', null);
    expect(await screen.findByRole('heading', { name: 'Spaceship X26' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Username'), 'ghost');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
  });

  it('shows passengers the resources their tier allows', async () => {
    renderApp('/resources', passenger, { '/api/resources': { resources: [cabin] } });
    expect(await screen.findByRole('heading', { name: 'Private Cabin' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My bookings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it('keeps passengers out of admin pages', async () => {
    renderApp('/admin/passengers', passenger, { '/api/resources': { resources: [] } });
    expect(await screen.findByRole('heading', { name: 'Ship resources' })).toBeInTheDocument();
  });

  it('lands crew leads in the admin module', async () => {
    renderApp('/', crewLead, { '/api/admin/passengers': { passengers: [passenger] } });
    expect(await screen.findByRole('heading', { name: 'Passengers' })).toBeInTheDocument();
    expect(await screen.findByText('Gwen Alvarez')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
  });
});
