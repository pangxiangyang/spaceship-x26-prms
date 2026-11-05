import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { TierBadge } from './ui';

const PASSENGER_NAV = [
  { to: '/resources', label: 'Resources' },
  { to: '/bookings', label: 'My bookings' },
  { to: '/history', label: 'My history' },
];

const CREW_NAV = [
  { to: '/admin/passengers', label: 'Passengers' },
  { to: '/admin/resources', label: 'Resources' },
  { to: '/admin/reports', label: 'Reports' },
  { to: '/admin/audit', label: 'Audit log' },
];

export function Layout() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const nav = user.role === 'CREW_LEAD' ? CREW_NAV : PASSENGER_NAV;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>
            X26 <strong>PRMS</strong>
          </span>
          {user.role === 'CREW_LEAD' && <span className="badge badge-crew">Crew Lead</span>}
        </div>
        <nav aria-label="Main">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="user-menu">
          <span className="user-name">{user.displayName}</span>
          {user.tier && <TierBadge tier={user.tier} />}
          <button type="button" className="button ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <footer className="footer muted">Spaceship X26 · Earth → Mars settlement mission</footer>
    </div>
  );
}
