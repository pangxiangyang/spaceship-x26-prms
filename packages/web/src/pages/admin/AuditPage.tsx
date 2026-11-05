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
  const [page, setPage] = useState(0);
  const { data, error, loading } = useApiData(
    (api) =>
      api.get<{ total: number; events: AuditEvent[] }>('/api/admin/audit', {
        action,
        outcome,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    [action, outcome, page],
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every resource interaction and administrative action, newest first."
      />
      <div className="filters">
        <label>
          Action
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(0);
            }}
          >
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
          <select
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              setPage(0);
            }}
          >
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
            onClick={() => setPage(page - 1)}
          >
            ← Newer
          </button>
          <span className="muted">
            Page {page + 1} of {pages}
          </span>
          <button
            type="button"
            className="button ghost small"
            disabled={page + 1 >= pages}
            onClick={() => setPage(page + 1)}
          >
            Older →
          </button>
        </div>
      )}
    </>
  );
}
