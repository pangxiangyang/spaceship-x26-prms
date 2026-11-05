import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Tier, User } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import {
  EmptyState,
  ErrorBanner,
  Loading,
  Modal,
  Notice,
  PageHeader,
  TierBadge,
} from '../../components/ui';
import { useAction, useApiData } from '../../hooks/useApiData';
import { TIERS, TIER_LABELS } from '../../lib/format';

interface TierChangeResponse {
  passenger: User;
  change: { from: Tier; to: Tier; direction: 'UPGRADE' | 'DOWNGRADE' };
  revokedBookingIds: string[];
}

export function PassengersPage() {
  const { api } = useAuth();
  const { data, error, loading, reload } = useApiData(
    (client) => client.get<{ passengers: User[] }>('/api/admin/passengers'),
    [],
  );
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [filter, setFilter] = useState('');

  const changeTier = useAction(async (passenger: User, tier: Tier) => {
    const result = await api.put<TierChangeResponse>(`/api/admin/passengers/${passenger.id}/tier`, {
      tier,
    });
    const revoked = result.revokedBookingIds.length;
    setNotice(
      `${passenger.displayName} ${result.change.direction === 'UPGRADE' ? 'upgraded' : 'downgraded'} to ${TIER_LABELS[tier]}.` +
        (revoked
          ? ` ${revoked} booking${revoked === 1 ? ' was' : 's were'} cancelled because the new tier no longer covers ${revoked === 1 ? 'it' : 'them'}.`
          : ''),
    );
    reload();
  });

  const onTierSelect = (passenger: User, tier: Tier) => {
    if (tier === passenger.tier) return;
    const downgrade = TIERS.indexOf(tier) < TIERS.indexOf(passenger.tier!);
    const message = downgrade
      ? `Downgrade ${passenger.displayName} to ${TIER_LABELS[tier]}? Their upcoming bookings for higher-tier resources will be cancelled.`
      : `Upgrade ${passenger.displayName} to ${TIER_LABELS[tier]}?`;
    if (window.confirm(message)) void changeTier.run(passenger, tier);
  };

  const passengers = (data?.passengers ?? []).filter((p) =>
    `${p.displayName} ${p.username}`.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Passengers"
        subtitle="Create profiles and manage membership tiers."
        actions={
          <button type="button" className="button primary" onClick={() => setCreating(true)}>
            New passenger
          </button>
        }
      />
      {notice && <Notice>{notice}</Notice>}
      <ErrorBanner error={error ?? changeTier.error} />
      <input
        type="search"
        className="search"
        placeholder="Search by name or username"
        aria-label="Search passengers"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {loading && !data && <Loading />}
      {data && passengers.length === 0 && <EmptyState title="No passengers found" />}
      {passengers.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Tier</th>
                <th>Change tier</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {passengers.map((p) => (
                <tr key={p.id}>
                  <td>{p.displayName}</td>
                  <td>
                    <code>{p.username}</code>
                  </td>
                  <td>{p.tier && <TierBadge tier={p.tier} />}</td>
                  <td>
                    <select
                      aria-label={`Tier for ${p.displayName}`}
                      value={p.tier ?? ''}
                      disabled={changeTier.pending}
                      onChange={(e) => onTierSelect(p, e.target.value as Tier)}
                    >
                      {TIERS.map((t) => (
                        <option key={t} value={t}>
                          {TIER_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <Link to={`/admin/passengers/${p.id}`}>History →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <CreatePassengerDialog
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            setNotice(`Created ${p.displayName} (${p.username}).`);
            reload();
          }}
        />
      )}
    </>
  );
}

function CreatePassengerDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: User) => void;
}) {
  const { api } = useAuth();
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    tier: 'SILVER' as Tier,
    password: '',
  });
  const create = useAction(async () => {
    const result = await api.post<{ passenger: User }>('/api/admin/passengers', form);
    onCreated(result.passenger);
  });
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void create.run();
  };

  return (
    <Modal title="New passenger" open onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Display name
          <input value={form.displayName} onChange={set('displayName')} required maxLength={80} />
        </label>
        <label>
          Username
          <input
            value={form.username}
            onChange={set('username')}
            required
            pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,31}"
            title="3-32 letters, digits, dots, dashes or underscores"
          />
        </label>
        <label>
          Membership tier
          <select value={form.tier} onChange={set('tier')}>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Initial password
          <input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={8}
          />
        </label>
        <ErrorBanner error={create.error} />
        <div className="form-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={create.pending}>
            Create passenger
          </button>
        </div>
      </form>
    </Modal>
  );
}
