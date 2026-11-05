import { Link, useParams } from 'react-router-dom';
import type { Booking, HistorySummary, User } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { HistoryView } from '../../components/HistoryView';
import { ErrorBanner, Loading, PageHeader, TierBadge } from '../../components/ui';
import { useAction, useApiData } from '../../hooks/useApiData';

export function PassengerDetailPage() {
  const { id = '' } = useParams();
  const { api } = useAuth();
  const { data, error, loading, reload } = useApiData(
    (client) =>
      client.get<{ passenger: User; summary: HistorySummary; entries: Booking[] }>(
        `/api/admin/passengers/${id}/history`,
      ),
    [id],
  );
  const cancel = useAction(async (bookingId: string) => {
    await api.post(`/api/bookings/${bookingId}/cancel`);
    reload();
  });

  return (
    <>
      <p>
        <Link to="/admin/passengers">← All passengers</Link>
      </p>
      <PageHeader
        title={data?.passenger.displayName ?? 'Passenger'}
        subtitle={data ? `@${data.passenger.username}` : undefined}
        actions={data?.passenger.tier && <TierBadge tier={data.passenger.tier} />}
      />
      <ErrorBanner error={error ?? cancel.error} />
      {loading && !data && <Loading />}
      {data && (
        <HistoryView
          summary={data.summary}
          entries={data.entries}
          renderActions={(b) =>
            b.lifecycle === 'UPCOMING' ? (
              <button
                type="button"
                className="button ghost danger small"
                disabled={cancel.pending}
                onClick={() =>
                  window.confirm('Cancel this booking on behalf of the passenger?') &&
                  void cancel.run(b.id)
                }
              >
                Cancel
              </button>
            ) : null
          }
        />
      )}
    </>
  );
}
