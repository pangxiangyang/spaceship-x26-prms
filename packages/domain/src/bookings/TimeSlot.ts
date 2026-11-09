import { ValidationError } from '../shared/errors';
import { requireValidDate } from '../shared/validation';

const MINUTE_MS = 60_000;
/** The latest instant a JavaScript Date can hold. */
const END_OF_TIME = new Date(8_640_000_000_000_000);

/** A half-open time interval [start, end). Back-to-back slots do not overlap. */
export class TimeSlot {
  private constructor(
    readonly start: Date,
    readonly end: Date,
  ) {}

  static of(start: Date, end: Date): TimeSlot {
    requireValidDate(start, 'Start time');
    requireValidDate(end, 'End time');
    if (end.getTime() <= start.getTime()) {
      throw new ValidationError('End time must be after start time.');
    }
    return new TimeSlot(new Date(start), new Date(end));
  }

  /** Everything from `start` on, e.g. "bookings that have not ended yet". */
  static onwardsFrom(start: Date): TimeSlot {
    return TimeSlot.of(start, END_OF_TIME);
  }

  get durationMinutes(): number {
    return (this.end.getTime() - this.start.getTime()) / MINUTE_MS;
  }

  overlaps(other: TimeSlot): boolean {
    return this.start < other.end && other.start < this.end;
  }

  hasStarted(now: Date): boolean {
    return this.start.getTime() <= now.getTime();
  }

  hasEnded(now: Date): boolean {
    return this.end.getTime() <= now.getTime();
  }

  /** The part of this slot that falls inside `window`, if any. */
  clampTo(window: TimeSlot): TimeSlot | undefined {
    if (!this.overlaps(window)) return undefined;
    const start = this.start > window.start ? this.start : window.start;
    const end = this.end < window.end ? this.end : window.end;
    return new TimeSlot(start, end);
  }
}

/**
 * The maximum number of slots that are simultaneously in progress at any instant
 * (optionally only counting the part of each slot inside `within`).
 *
 * This is what capacity must be checked against: two bookings 09:00-10:00 and
 * 10:00-11:00 overlapping a request for 09:00-11:00 only ever use one seat each
 * at a time, so a capacity-2 resource can still accept the request.
 */
export function peakConcurrency(slots: readonly TimeSlot[], within?: TimeSlot): number {
  const relevant = within ? slots.flatMap((s) => s.clampTo(within) ?? []) : slots;
  const edges = relevant.flatMap((s) => [
    { at: s.start.getTime(), delta: 1 },
    { at: s.end.getTime(), delta: -1 },
  ]);
  // Ends sort before starts at the same instant: [09-10) and [10-11) never coincide.
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);

  let current = 0;
  let peak = 0;
  for (const edge of edges) {
    current += edge.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}
