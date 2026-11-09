import { useState } from 'react';
import type { AuditEvent } from '../../api/types';
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../components/ui';
import { useApiData } from '../../hooks/useApiData';
import { formatCode, formatDateTime } from '../../lib/format';

const ACTIONS = [
  'BOOKING_CREATE',
  'BOOKING_CANCEL',
  'USAGE_START',
  'TIER_CHANGE',
  'PASSENGER_CREATE',
  'PASSENGER_UPDATE',
  'RESOURCE_PROVISION',
  'RESOURCE_UPDATE',
  'RESOURCE_DECOMMISSION',
  'CREW_LEAD_REGISTER',
];
const PAGE_SIZE = 50;

export function AuditPage() {
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  // The server pages with cursors: keep the cursor of every page opened so far, so
  // "Newer" can go back. An empty stack is the first (newest) page.
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const page = cursors.length;
  const { data, error, loading } = useApiData(
    (api) =>
      api.get<{ total: number; nextCursor: string | null; events: AuditEvent[] }>(
        '/api/admin/audit',
        { action, outcome, limit: PAGE_SIZE, cursor },
      ),
    [action, outcome, cursor],
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filterBy = (set: (value: string) => void) => (value: string) => {
    set(value);
    setCursors([]);
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every resource interaction and administrative action, newest first."
      />
      <div className="filters">
        <label>
          Action
          <select value={action} onChange={(e) => filterBy(setAction)(e.target.value)}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {formatCode(a)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Outcome
          <select value={outcome} onChange={(e) => filterBy(setOutcome)(e.target.value)}>
            <option value="">Any outcome</option>
            <option value="SUCCESS">Success</option>
            <option value="DENIED">Denied</option>
          </select>
        </label>
        {data && <span className="muted">{data.total} events</span>}
      </div>
      <ErrorBanner error={error} />
      {loading && !data && <Loading />}
      {data && data.events.length === 0 && <EmptyState title="No matching events" />}
      {data && data.events.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Outcome</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{formatDateTime(e.occurredAt)}</td>
                  <td>
                    {e.actor.displayName ?? e.actor.userId}
                    <div className="muted small">{formatCode(e.actor.role)}</div>
                  </td>
                  <td>{formatCode(e.action)}</td>
                  <td>
                    <span className={`badge outcome-${e.outcome.toLowerCase()}`}>
                      {formatCode(e.outcome)}
                    </span>
                  </td>
                  <td className="details">
                    {Object.entries(e.details)
                      .filter(([key]) => key !== 'message' || e.outcome === 'DENIED')
                      .map(([key, value]) => (
                        <span key={key}>
                          <span className="muted">{key}:</span> {String(value)}
                        </span>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && pages > 1 && (
        <div className="pagination">
          <button
            type="button"
            className="button ghost small"
            disabled={page === 0}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            ← Newer
          </button>
          <span className="muted">
            Page {page + 1} of {pages}
          </span>
          <button
            type="button"
            className="button ghost small"
            disabled={!data.nextCursor}
            onClick={() => data.nextCursor && setCursors([...cursors, data.nextCursor])}
          >
            Older →
          </button>
        </div>
      )}
    </>
  );
}
