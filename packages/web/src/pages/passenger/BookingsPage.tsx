import type { Booking, Meta } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { EmptyState, ErrorBanner, LifecycleBadge, Loading, PageHeader } from '../../components/ui';
import { useAction, useApiData } from '../../hooks/useApiData';
import { CATEGORY_ICONS, formatCode, formatMinutes, formatSlot } from '../../lib/format';

const isActive = (b: Booking) => b.lifecycle === 'UPCOMING' || b.lifecycle === 'IN_PROGRESS';

/**
 * Whether check-in is open yet, using the server's check-in window. Until that is known,
 * the button stays available and the server decides.
 */
function canCheckIn(booking: Booking, leadMinutes: number | undefined, now = Date.now()): boolean {
  if (booking.lifecycle !== 'UPCOMING') return false;
  if (leadMinutes === undefined) return true;
  return now >= new Date(booking.start).getTime() - leadMinutes * 60_000;
}

export function BookingsPage() {
  const { api } = useAuth();
  const { data, error, loading, reload } = useApiData(
    (client) => client.get<{ bookings: Booking[] }>('/api/bookings'),
    [],
  );
  const meta = useApiData((client) => client.get<Meta>('/api/meta'), []);
  const leadMinutes = meta.data?.bookingPolicy.checkInLeadMinutes;
  const action = useAction(async (bookingId: string, kind: 'check-in' | 'cancel') => {
    await api.post(`/api/bookings/${bookingId}/${kind}`);
    reload();
  });

  const bookings = data?.bookings ?? [];
  // Soonest first for what is coming up; most recent first for the past.
  const active = bookings.filter(isActive).reverse();
  const past = bookings.filter((b) => !isActive(b));

  return (
    <>
      <PageHeader
        title="My bookings"
        subtitle="Check in when your slot opens, or cancel if plans change."
      />
      <ErrorBanner error={error ?? action.error} />
      {loading && !data && <Loading />}

      <section>
        <h2 className="section-title">Upcoming &amp; in progress</h2>
        {data && active.length === 0 && (
          <EmptyState title="Nothing booked yet">Browse resources to make a booking.</EmptyState>
        )}
        <ul className="booking-list">
          {active.map((booking) => (
            <li key={booking.id} className="card booking-row">
              <span className="resource-icon small" aria-hidden>
                {booking.category ? CATEGORY_ICONS[booking.category] : '•'}
              </span>
              <div className="booking-main">
                <strong>{booking.resourceName}</strong>
                <span className="muted">
                  {formatSlot(booking.start, booking.end)} ·{' '}
                  {formatMinutes(booking.durationMinutes)}
                </span>
              </div>
              <LifecycleBadge lifecycle={booking.lifecycle} />
              <div className="row-actions">
                {booking.lifecycle === 'UPCOMING' && (
                  <>
                    <button
                      type="button"
                      className="button primary"
                      disabled={action.pending || !canCheckIn(booking, leadMinutes)}
                      title={
                        canCheckIn(booking, leadMinutes)
                          ? undefined
                          : `Check-in opens ${leadMinutes} minutes before the start`
                      }
                      onClick={() => void action.run(booking.id, 'check-in')}
                    >
                      Check in
                    </button>
                    <button
                      type="button"
                      className="button ghost danger"
                      disabled={action.pending}
                      onClick={() => {
                        if (window.confirm(`Cancel your booking for ${booking.resourceName}?`)) {
                          void action.run(booking.id, 'cancel');
                        }
                      }}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="section-title">Past</h2>
        {data && past.length === 0 && <p className="muted">No past bookings.</p>}
        {past.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>When</th>
                  <th>Status</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {past.map((booking) => (
                  <tr key={booking.id}>
                    <td>{booking.resourceName}</td>
                    <td>{formatSlot(booking.start, booking.end)}</td>
                    <td>
                      <LifecycleBadge lifecycle={booking.lifecycle} />
                    </td>
                    <td className="muted">
                      {booking.cancellationReason ? formatCode(booking.cancellationReason) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
