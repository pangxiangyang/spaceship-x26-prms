import { useEffect, useRef, type ReactNode } from 'react';
import type { ApiError } from '../api/client';
import type { Lifecycle, Tier } from '../api/types';
import { LIFECYCLE_LABELS, TIER_LABELS } from '../lib/format';

export function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`badge tier-${tier.toLowerCase()}`}>{TIER_LABELS[tier]}</span>;
}

export function LifecycleBadge({ lifecycle }: { lifecycle: Lifecycle }) {
  return (
    <span className={`badge lifecycle-${lifecycle.toLowerCase().replace('_', '-')}`}>
      {LIFECYCLE_LABELS[lifecycle]}
    </span>
  );
}

export function ErrorBanner({ error }: { error: ApiError | undefined }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <strong>{error.message}</strong>
      {error.issues.length > 0 && (
        <ul>
          {error.issues.map((issue) => (
            <li key={issue.path + issue.message}>
              {issue.path && <code>{issue.path}</code>} {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="alert alert-success" role="status">
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted" aria-live="polite">
      {label}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

/** Accessible modal built on the native <dialog> element. */
export function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-labelledby="modal-title">
      {open && (
        <>
          <header className="modal-header">
            <h2 id="modal-title">{title}</h2>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              ×
            </button>
          </header>
          {children}
        </>
      )}
    </dialog>
  );
}

export function Meter({ ratio, level }: { ratio: number; level?: 'HIGH' | 'MODERATE' | 'LOW' }) {
  const pct = Math.min(Math.max(ratio, 0), 1) * 100;
  return (
    <div
      className="meter"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div
        className={`meter-fill ${level ? `level-${level.toLowerCase()}` : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
