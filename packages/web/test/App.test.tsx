import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Resource, User } from '../src/api/types';
import { App } from '../src/App';
import { AuthProvider } from '../src/auth/AuthContext';
import { fakeApi } from './support/fakeApi';

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

  it('offers the demo sign-in details the server publishes', async () => {
    renderApp('/login', null, {
      '/api/meta': {
        demo: {
          accounts: [{ label: 'Crew Lead', username: 'commander', password: 'mission-control' }],
        },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /Crew Lead/ }));
    expect(screen.getByLabelText('Username')).toHaveValue('commander');
    expect(screen.getByLabelText('Password')).toHaveValue('mission-control');
  });

  it('shows no demo accounts outside demo mode', async () => {
    renderApp('/login', null, { '/api/meta': { demo: null } });
    expect(await screen.findByRole('heading', { name: 'Spaceship X26' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Demo accounts')).not.toBeInTheDocument());
  });

  it('shows passengers the resources their tier allows', async () => {
    renderApp('/resources', passenger, { '/api/resources': { resources: [cabin] } });
    expect(await screen.findByRole('heading', { name: 'Private Cabin' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My bookings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it('shows the tier the server holds now, not the one from sign-in', async () => {
    const routes: Record<string, unknown> = {
      '/api/resources': { resources: [cabin] },
      '/api/me': { user: { ...passenger, tier: 'PLATINUM' } },
    };
    renderApp('/resources', passenger, routes);
    const menu = (await screen.findByText('Gwen Alvarez')).closest('.user-menu') as HTMLElement;
    expect(await within(menu).findByText('Platinum')).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('prms.session')!).user.tier).toBe('PLATINUM');

    // A Crew Lead downgrades the passenger while the tab is in the background.
    routes['/api/me'] = { user: { ...passenger, tier: 'SILVER' } };
    window.dispatchEvent(new Event('focus'));
    expect(await within(menu).findByText('Silver')).toBeInTheDocument();
  });

  it('keeps passengers out of admin pages', async () => {
    renderApp('/admin/passengers', passenger, { '/api/resources': { resources: [] } });
    expect(await screen.findByRole('heading', { name: 'Ship resources' })).toBeInTheDocument();
  });

  it('explains why a resource is in high demand, using the server thresholds', async () => {
    const period = { from: '2026-03-01T00:00:00Z', to: '2026-03-08T00:00:00Z' };
    const row = {
      category: 'OXYGEN',
      minTier: 'PLATINUM',
      capacity: 2,
      bookings: 12,
      minutesBooked: 1440,
    };
    renderApp('/admin/reports', crewLead, {
      '/api/admin/reports/tier-usage': { period, tiers: [] },
      '/api/admin/reports/resource-demand': {
        period,
        thresholds: { high: 0.8, moderate: 0.5 },
        resources: [
          {
            ...row,
            resourceId: 'r1',
            resourceName: 'Luxury O2 Pod',
            utilization: 0.0714,
            peakUtilization: 1,
            capacityDenials: 6,
            demandLevel: 'HIGH',
            demandReason: 'TURNED_AWAY',
          },
          {
            ...row,
            resourceId: 'r2',
            resourceName: 'Fitness Center',
            utilization: 0.85,
            peakUtilization: 1,
            capacityDenials: 0,
            demandLevel: 'HIGH',
            demandReason: 'UTILIZATION',
          },
        ],
      },
    });

    const o2 = (await screen.findByText('Luxury O2 Pod', { selector: 'td' })).closest('tr')!;
    expect(within(o2).getByText('7%')).toBeInTheDocument();
    expect(within(o2).getByText('100%')).toBeInTheDocument();
    expect(within(o2).getByText('High · 6 turned away')).toBeInTheDocument();
    const gym = screen.getByText('Fitness Center', { selector: 'td' }).closest('tr')!;
    expect(within(gym).getByText('High · 85% average use')).toBeInTheDocument();
    expect(screen.getByText(/average use reaches 80%/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Luxury O2 Pod (6 turned away)');
  });

  it('lands crew leads in the admin module', async () => {
    renderApp('/', crewLead, { '/api/admin/passengers': { passengers: [passenger] } });
    expect(await screen.findByRole('heading', { name: 'Passengers' })).toBeInTheDocument();
    expect(await screen.findByText('Gwen Alvarez')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
  });
});
