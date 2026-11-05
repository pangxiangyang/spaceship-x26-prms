import type { Booking, Category, HistorySummary } from '../api/types';
import { CATEGORY_LABELS, formatCode, formatMinutes, formatSlot } from '../lib/format';
import { EmptyState, LifecycleBadge, Meter, Stat } from './ui';

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

/** Shared by the passenger's own history page and the Crew Lead's passenger detail. */
export function HistoryView({
  summary,
  entries,
  renderActions,
}: {
  summary: HistorySummary;
  entries: Booking[];
  renderActions?: (booking: Booking) => React.ReactNode;
}) {
  const categories = Object.entries(summary.minutesByCategory) as [Category, number][];
  const maxCategory = Math.max(1, ...categories.map(([, m]) => m));
  const maxDay = Math.max(1, ...summary.dailyUsage.map((d) => d.minutes));

  return (
    <>
      <div className="stats">
        <Stat label="Time used" value={formatMinutes(summary.minutesUsed)} />
        <Stat label="Completed" value={summary.completed + summary.inProgress} />
        <Stat label="Upcoming" value={summary.upcoming} />
        <Stat label="Missed" value={summary.missed} hint="Booked but not checked in" />
        <Stat label="Cancelled" value={summary.cancelled} />
      </div>

      <div className="two-col">
        <section className="card">
          <h2 className="section-title">Last 7 days</h2>
          <div
            className="bar-chart"
            role="img"
            aria-label="Minutes used per day over the last 7 days"
          >
            {summary.dailyUsage.map((day) => (
              <div
                key={day.date}
                className="bar-col"
                title={`${day.date}: ${formatMinutes(day.minutes)}`}
              >
                <div className="bar" style={{ height: `${(day.minutes / maxDay) * 100}%` }} />
                <span className="bar-label">
                  {weekday.format(new Date(`${day.date}T12:00:00Z`))}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h2 className="section-title">Time by resource type</h2>
          {categories.length === 0 ? (
            <p className="muted">No completed sessions yet.</p>
          ) : (
            <ul className="category-bars">
              {categories
                .sort((a, b) => b[1] - a[1])
                .map(([category, minutes]) => (
                  <li key={category}>
                    <span>{CATEGORY_LABELS[category]}</span>
                    <Meter ratio={minutes / maxCategory} />
                    <span className="muted">{formatMinutes(minutes)}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      <section>
        <h2 className="section-title">All bookings</h2>
        {entries.length === 0 ? (
          <EmptyState title="No bookings yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>When</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Note</th>
                  {renderActions && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {entries.map((b) => (
                  <tr key={b.id}>
                    <td>{b.resourceName}</td>
                    <td>{formatSlot(b.start, b.end)}</td>
                    <td>{formatMinutes(b.durationMinutes)}</td>
                    <td>
                      <LifecycleBadge lifecycle={b.lifecycle} />
                    </td>
                    <td className="muted">
                      {b.cancellationReason ? formatCode(b.cancellationReason) : ''}
                    </td>
                    {renderActions && <td>{renderActions(b)}</td>}
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
