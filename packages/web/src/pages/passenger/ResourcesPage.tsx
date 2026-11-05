import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Booking, Resource } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import {
  EmptyState,
  ErrorBanner,
  Loading,
  Notice,
  PageHeader,
  TierBadge,
} from '../../components/ui';
import { useApiData } from '../../hooks/useApiData';
import { CATEGORY_ICONS, CATEGORY_LABELS, TIER_LABELS, formatSlot } from '../../lib/format';
import { BookingDialog } from './BookingDialog';

export function ResourcesPage() {
  const { user } = useAuth();
  const { data, error, loading } = useApiData(
    (api) => api.get<{ resources: Resource[] }>('/api/resources'),
    [],
  );
  const [selected, setSelected] = useState<Resource>();
  const [booked, setBooked] = useState<Booking>();

  return (
    <>
      <PageHeader
        title="Ship resources"
        subtitle={`Everything your ${user?.tier ? TIER_LABELS[user.tier] : ''} membership gives you access to.`}
      />
      {booked && (
        <Notice>
          Booked <strong>{booked.resourceName}</strong> for {formatSlot(booked.start, booked.end)}.{' '}
          <Link to="/bookings">View my bookings →</Link>
        </Notice>
      )}
      <ErrorBanner error={error} />
      {loading && !data && <Loading />}
      {data && data.resources.length === 0 && (
        <EmptyState title="No resources available">
          Ask a Crew Lead if you think this is wrong.
        </EmptyState>
      )}
      <div className="card-grid">
        {data?.resources.map((resource) => (
          <article key={resource.id} className="card resource-card">
            <div className="resource-icon" aria-hidden>
              {CATEGORY_ICONS[resource.category]}
            </div>
            <div className="resource-body">
              <h2>{resource.name}</h2>
              <p className="muted">{resource.description || CATEGORY_LABELS[resource.category]}</p>
              <div className="resource-meta">
                <TierBadge tier={resource.minTier} />
                <span className="muted">
                  {resource.capacity} at a time · {CATEGORY_LABELS[resource.category]}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="button primary"
              onClick={() => {
                setBooked(undefined);
                setSelected(resource);
              }}
            >
              Book
            </button>
          </article>
        ))}
      </div>
      {selected && (
        <BookingDialog
          resource={selected}
          onClose={() => setSelected(undefined)}
          onBooked={(booking) => {
            setSelected(undefined);
            setBooked(booking);
          }}
        />
      )}
    </>
  );
}
