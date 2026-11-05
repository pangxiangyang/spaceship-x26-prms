import { useState, type FormEvent } from 'react';
import type { Category, Resource, Tier } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { ErrorBanner, Loading, Modal, Notice, PageHeader, TierBadge } from '../../components/ui';
import { useAction, useApiData } from '../../hooks/useApiData';
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS, TIERS, TIER_LABELS } from '../../lib/format';

interface ResourceForm {
  name: string;
  description: string;
  category: Category;
  minTier: Tier;
  capacity: number;
}

const EMPTY_FORM: ResourceForm = {
  name: '',
  description: '',
  category: 'SLEEPING_POD',
  minTier: 'SILVER',
  capacity: 1,
};

interface MutationResult {
  resource: Resource;
  revokedBookingIds: string[];
}

const revokedNote = (n: number) =>
  n ? ` ${n} pending booking${n === 1 ? ' was' : 's were'} cancelled.` : '';

export function ResourcesAdminPage() {
  const { api } = useAuth();
  const { data, error, loading, reload } = useApiData(
    (client) => client.get<{ resources: Resource[] }>('/api/admin/resources'),
    [],
  );
  const [editing, setEditing] = useState<Resource | 'new'>();
  const [notice, setNotice] = useState<string>();

  const decommission = useAction(async (resource: Resource) => {
    const result = await api.post<MutationResult>(
      `/api/admin/resources/${resource.id}/decommission`,
    );
    setNotice(`${resource.name} decommissioned.${revokedNote(result.revokedBookingIds.length)}`);
    reload();
  });

  return (
    <>
      <PageHeader
        title="Resource inventory"
        subtitle="Provision, adjust and decommission ship resources."
        actions={
          <button type="button" className="button primary" onClick={() => setEditing('new')}>
            Provision resource
          </button>
        }
      />
      {notice && <Notice>{notice}</Notice>}
      <ErrorBanner error={error ?? decommission.error} />
      {loading && !data && <Loading />}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Category</th>
                <th>Minimum tier</th>
                <th>Capacity</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.resources.map((r) => (
                <tr key={r.id} className={r.status === 'DECOMMISSIONED' ? 'is-retired' : ''}>
                  <td>
                    <span aria-hidden>{CATEGORY_ICONS[r.category]}</span> {r.name}
                    {r.description && <div className="muted small">{r.description}</div>}
                  </td>
                  <td>{CATEGORY_LABELS[r.category]}</td>
                  <td>
                    <TierBadge tier={r.minTier} />
                  </td>
                  <td>{r.capacity}</td>
                  <td>{r.status === 'ACTIVE' ? 'Active' : 'Decommissioned'}</td>
                  <td className="row-actions">
                    {r.status === 'ACTIVE' && (
                      <>
                        <button
                          type="button"
                          className="button ghost small"
                          onClick={() => setEditing(r)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button ghost danger small"
                          disabled={decommission.pending}
                          onClick={() =>
                            window.confirm(
                              `Decommission ${r.name}? Pending bookings will be cancelled. This cannot be undone.`,
                            ) && void decommission.run(r)
                          }
                        >
                          Decommission
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ResourceDialog
          resource={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={(message) => {
            setEditing(undefined);
            setNotice(message);
            reload();
          }}
        />
      )}
    </>
  );
}

function ResourceDialog({
  resource,
  onClose,
  onSaved,
}: {
  resource?: Resource;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { api } = useAuth();
  const [form, setForm] = useState<ResourceForm>(
    resource
      ? {
          name: resource.name,
          description: resource.description,
          category: resource.category,
          minTier: resource.minTier,
          capacity: resource.capacity,
        }
      : EMPTY_FORM,
  );
  const save = useAction(async () => {
    if (resource) {
      const result = await api.patch<MutationResult>(`/api/admin/resources/${resource.id}`, form);
      onSaved(`${result.resource.name} updated.${revokedNote(result.revokedBookingIds.length)}`);
    } else {
      const result = await api.post<{ resource: Resource }>('/api/admin/resources', form);
      onSaved(`${result.resource.name} provisioned.`);
    }
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run();
  };

  return (
    <Modal title={resource ? `Edit ${resource.name}` : 'Provision resource'} open onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Name
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            maxLength={80}
          />
        </label>
        <label>
          Description
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={280}
            rows={2}
          />
        </label>
        <div className="form-row">
          <label>
            Category
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Minimum tier
            <select
              value={form.minTier}
              onChange={(e) => setForm({ ...form, minTier: e.target.value as Tier })}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Capacity
            <input
              type="number"
              min={1}
              max={500}
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
              required
            />
          </label>
        </div>
        {resource &&
          form.minTier !== resource.minTier &&
          TIERS.indexOf(form.minTier) > TIERS.indexOf(resource.minTier) && (
            <p className="alert alert-warning">
              Raising the minimum tier cancels pending bookings of passengers below{' '}
              {TIER_LABELS[form.minTier]}.
            </p>
          )}
        <ErrorBanner error={save.error} />
        <div className="form-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={save.pending}>
            {resource ? 'Save changes' : 'Provision'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
