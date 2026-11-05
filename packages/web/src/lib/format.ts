import type { Category, Lifecycle, Tier } from '../api/types';

export const CATEGORY_LABELS: Record<Category, string> = {
  SLEEPING_POD: 'Sleeping pod',
  FOOD_STATION: 'Food station',
  OXYGEN: 'Oxygen',
  MEDICAL: 'Medical',
  HYGIENE: 'Hygiene',
  FITNESS: 'Fitness',
  CABIN: 'Cabin',
  RECREATION: 'Recreation',
};

export const CATEGORY_ICONS: Record<Category, string> = {
  SLEEPING_POD: '🛏️',
  FOOD_STATION: '🍲',
  OXYGEN: '🫧',
  MEDICAL: '🩺',
  HYGIENE: '🚿',
  FITNESS: '🏋️',
  CABIN: '🚪',
  RECREATION: '🔭',
};

export const TIER_LABELS: Record<Tier, string> = {
  SILVER: 'Silver',
  GOLD: 'Gold',
  PLATINUM: 'Platinum',
};

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  UPCOMING: 'Upcoming',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  MISSED: 'Missed',
  CANCELLED: 'Cancelled',
};

const humanise = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');

export const formatCode = (code: string | null | undefined) => (code ? humanise(code) : '—');

const dateTime = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatTime = (iso: string) => time.format(new Date(iso));

export function formatSlot(start: string, end: string): string {
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  return `${formatDateTime(start)} – ${sameDay ? formatTime(end) : formatDateTime(end)}`;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export const formatPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** YYYY-MM-DD for a local date, as used by <input type="date">. */
export function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Combines a local date (YYYY-MM-DD) and time (HH:MM) into a Date. */
export function combineLocal(date: string, hhmm: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y!, mo! - 1, d!, h!, mi!);
}

/**
 * Highest number of overlapping intervals within [from, to) — mirrors the
 * server's capacity rule so the booking form can warn before submitting.
 */
export function peakOverlap(
  intervals: { start: string; end: string }[],
  from: Date,
  to: Date,
): number {
  const edges: { at: number; delta: number }[] = [];
  for (const i of intervals) {
    const s = Math.max(new Date(i.start).getTime(), from.getTime());
    const e = Math.min(new Date(i.end).getTime(), to.getTime());
    if (s < e) edges.push({ at: s, delta: 1 }, { at: e, delta: -1 });
  }
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const edge of edges) {
    current += edge.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

export const TIERS: Tier[] = ['SILVER', 'GOLD', 'PLATINUM'];
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];
export const CHECK_IN_LEAD_MINUTES = 15;
