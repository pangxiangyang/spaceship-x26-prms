import { useState } from 'react';
import type { DemandThresholds, ResourceDemand, TierUsage } from '../../api/types';
import { ErrorBanner, Loading, Meter, PageHeader, TierBadge } from '../../components/ui';
import { useApiData } from '../../hooks/useApiData';
import {
  CATEGORY_LABELS,
  formatCode,
  formatDateTime,
  formatMinutes,
  formatPercent,
} from '../../lib/format';

const PERIODS = [
  { label: 'Last 24 hours', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
];

interface Period {
  from: string;
  to: string;
}

/** Why a resource got its demand level, e.g. "6 turned away" or "82% average use". */
function demandReasonText(r: ResourceDemand): string | null {
  switch (r.demandReason) {
    case 'TURNED_AWAY':
      return `${r.capacityDenials} turned away`;
    case 'UTILIZATION':
      return `${formatPercent(r.utilization)} average use`;
    default:
      return null;
  }
}

function DemandBadge({ resource }: { resource: ResourceDemand }) {
  const reason = demandReasonText(resource);
  return (
    <span className={`badge demand-${resource.demandLevel.toLowerCase()}`}>
      {formatCode(resource.demandLevel)}
      {reason && ` · ${reason}`}
    </span>
  );
}

export function ReportsPage() {
  const [days, setDays] = useState(7);
  const range = () => {
    const to = new Date();
    return { from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString() };
  };
  const tiers = useApiData(
    (api) =>
      api.get<{ period: Period; tiers: TierUsage[] }>('/api/admin/reports/tier-usage', range()),
    [days],
  );
  const demand = useApiData(
    (api) =>
      api.get<{ period: Period; thresholds: DemandThresholds; resources: ResourceDemand[] }>(
        '/api/admin/reports/resource-demand',
        range(),
      ),
    [days],
  );
  const hot = demand.data?.resources.filter((r) => r.demandLevel === 'HIGH') ?? [];

  return (
    <>
      <PageHeader
        title="Reports & insights"
        subtitle={
          tiers.data
            ? `${formatDateTime(tiers.data.period.from)} – ${formatDateTime(tiers.data.period.to)}`
            : undefined
        }
        actions={
          <div className="segmented" role="group" aria-label="Report period">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                className={p.days === days ? 'active' : ''}
                aria-pressed={p.days === days}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />
      <ErrorBanner error={tiers.error ?? demand.error} />

      {hot.length > 0 && (
        <div className="alert alert-warning" role="status">
          <strong>Shortage risk:</strong>{' '}
          {hot.map((r) => `${r.resourceName} (${demandReasonText(r)})`).join(', ')}{' '}
          {hot.length === 1 ? 'is' : 'are'} in high demand. Consider adding capacity.
        </div>
      )}

      <section>
        <h2 className="section-title">Usage by membership tier</h2>
        {tiers.loading && !tiers.data && <Loading />}
        {tiers.data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Passengers</th>
                  <th>Bookings</th>
                  <th>Sessions used</th>
                  <th>Time booked</th>
                  <th>Time used</th>
                  <th>Most used</th>
                </tr>
              </thead>
              <tbody>
                {tiers.data.tiers.map((t) => (
                  <tr key={t.tier}>
                    <td>
                      <TierBadge tier={t.tier} />
                    </td>
                    <td>{t.passengerCount}</td>
                    <td>{t.bookings}</td>
                    <td>{t.sessionsUsed}</td>
                    <td>{formatMinutes(t.minutesBooked)}</td>
                    <td>{formatMinutes(t.minutesUsed)}</td>
                    <td>{t.topCategory ? CATEGORY_LABELS[t.topCategory] : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title">Resource demand</h2>
        {demand.data && (
          <p className="muted small">
            <strong>Average use</strong> is booked time divided by available time (capacity × the
            time in service during the period), so quiet nights pull it down.{' '}
            <strong>Peak use</strong> is how full the resource got at its busiest moment. A resource
            is in high demand as soon as anyone is turned away because it was full, or when average
            use reaches {formatPercent(demand.data.thresholds.high)}; moderate from{' '}
            {formatPercent(demand.data.thresholds.moderate)}.
          </p>
        )}
        {demand.loading && !demand.data && <Loading />}
        {demand.data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Tier</th>
                  <th>Capacity</th>
                  <th>Bookings</th>
                  <th>Average use</th>
                  <th className="wide">Peak use</th>
                  <th>Turned away</th>
                  <th>Demand</th>
                </tr>
              </thead>
              <tbody>
                {demand.data.resources.map((r) => (
                  <tr key={r.resourceId}>
                    <td>{r.resourceName}</td>
                    <td>
                      <TierBadge tier={r.minTier} />
                    </td>
                    <td>{r.capacity}</td>
                    <td>{r.bookings}</td>
                    <td>{formatPercent(r.utilization)}</td>
                    <td>
                      <div className="meter-row">
                        <Meter ratio={r.peakUtilization} level={r.demandLevel} />
                        <span>{formatPercent(r.peakUtilization)}</span>
                      </div>
                    </td>
                    <td>{r.capacityDenials}</td>
                    <td>
                      <DemandBadge resource={r} />
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
