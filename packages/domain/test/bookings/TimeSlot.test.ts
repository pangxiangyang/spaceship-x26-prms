import { describe, expect, it } from 'vitest';
import { TimeSlot, peakConcurrency } from '../../src/bookings/TimeSlot';
import { ValidationError } from '../../src/shared/errors';

const t = (hhmm: string) => new Date(`2026-03-01T${hhmm}:00Z`);
const slot = (from: string, to: string) => TimeSlot.of(t(from), t(to));

describe('TimeSlot', () => {
  it('computes its duration in minutes', () => {
    expect(slot('09:00', '10:30').durationMinutes).toBe(90);
  });

  it('rejects empty, reversed or invalid intervals', () => {
    expect(() => slot('10:00', '10:00')).toThrow(ValidationError);
    expect(() => slot('11:00', '10:00')).toThrow(ValidationError);
    expect(() => TimeSlot.of(new Date('nope'), t('10:00'))).toThrow(ValidationError);
  });

  it('treats intervals as half-open so back-to-back slots do not overlap', () => {
    expect(slot('09:00', '10:00').overlaps(slot('10:00', '11:00'))).toBe(false);
    expect(slot('09:00', '10:01').overlaps(slot('10:00', '11:00'))).toBe(true);
    expect(slot('09:00', '12:00').overlaps(slot('10:00', '11:00'))).toBe(true);
  });

  it('knows whether it has started or ended', () => {
    const s = slot('09:00', '10:00');
    expect(s.hasStarted(t('08:59'))).toBe(false);
    expect(s.hasStarted(t('09:00'))).toBe(true);
    expect(s.hasEnded(t('09:59'))).toBe(false);
    expect(s.hasEnded(t('10:00'))).toBe(true);
  });

  it('copies its dates so callers cannot mutate it', () => {
    const start = t('09:00');
    const s = TimeSlot.of(start, t('10:00'));
    start.setUTCHours(5);
    expect(s.start.toISOString()).toBe('2026-03-01T09:00:00.000Z');
  });
});

describe('peakConcurrency', () => {
  it('is zero for no slots', () => {
    expect(peakConcurrency([])).toBe(0);
  });

  it('counts simultaneous use, not the number of overlapping bookings', () => {
    // Two sequential bookings both overlap 09:00-11:00 but never at the same time.
    const sequential = [slot('09:00', '10:00'), slot('10:00', '11:00')];
    expect(peakConcurrency(sequential, slot('09:00', '11:00'))).toBe(1);
  });

  it('finds the busiest instant', () => {
    const slots = [slot('09:00', '12:00'), slot('10:00', '11:00'), slot('10:30', '13:00')];
    expect(peakConcurrency(slots)).toBe(3);
  });

  it('only counts the part of each slot inside the window', () => {
    const slots = [slot('09:00', '10:00'), slot('09:30', '10:00'), slot('11:00', '12:00')];
    expect(peakConcurrency(slots, slot('10:00', '11:00'))).toBe(0);
    expect(peakConcurrency(slots, slot('09:45', '11:30'))).toBe(2);
  });

  it('describes an open-ended window from a moment onwards', () => {
    const now = new Date('2026-03-01T10:00:00Z');
    const onwards = TimeSlot.onwardsFrom(now);
    expect(onwards.overlaps(TimeSlot.of(now, new Date('2026-03-01T10:15:00Z')))).toBe(true);
    expect(onwards.overlaps(TimeSlot.of(new Date('2099-01-01'), new Date('2099-01-02')))).toBe(
      true,
    );
    expect(onwards.overlaps(TimeSlot.of(new Date('2026-03-01T09:00:00Z'), now))).toBe(false);
  });
});
