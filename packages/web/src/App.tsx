import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { Role } from './api/types';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { AuditPage } from './pages/admin/AuditPage';
import { PassengerDetailPage } from './pages/admin/PassengerDetailPage';
import { PassengersPage } from './pages/admin/PassengersPage';
import { ReportsPage } from './pages/admin/ReportsPage';
import { ResourcesAdminPage } from './pages/admin/ResourcesAdminPage';
import { BookingsPage } from './pages/passenger/BookingsPage';
import { HistoryPage } from './pages/passenger/HistoryPage';
import { ResourcesPage } from './pages/passenger/ResourcesPage';

const homeFor = (role: Role) => (role === 'CREW_LEAD' ? '/admin/passengers' : '/resources');

/** Client-side gate for UX only; the API enforces every permission. */
function RequireRole({ role, children }: { role: Role; children: ReactElement }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

export function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to={homeFor(user.role)} replace /> : <LoginPage />}
      />
      <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
        <Route
          path="/resources"
          element={
            <RequireRole role="PASSENGER">
              <ResourcesPage />
            </RequireRole>
          }
        />
        <Route
          path="/bookings"
          element={
            <RequireRole role="PASSENGER">
              <BookingsPage />
            </RequireRole>
          }
        />
        <Route
          path="/history"
          element={
            <RequireRole role="PASSENGER">
              <HistoryPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/passengers"
          element={
            <RequireRole role="CREW_LEAD">
              <PassengersPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/passengers/:id"
          element={
            <RequireRole role="CREW_LEAD">
              <PassengerDetailPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/resources"
          element={
            <RequireRole role="CREW_LEAD">
              <ResourcesAdminPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <RequireRole role="CREW_LEAD">
              <ReportsPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <RequireRole role="CREW_LEAD">
              <AuditPage />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to={user ? homeFor(user.role) : '/login'} replace />} />
    </Routes>
  );
}
