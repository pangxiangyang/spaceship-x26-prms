import { describe, expect, it } from 'vitest';
import {
  combineLocal,
  formatCode,
  formatMinutes,
  peakOverlap,
  toDateInputValue,
} from '../src/lib/format';

describe('format helpers', () => {
  it('formats durations', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(135)).toBe('2 h 15 min');
  });

  it('humanises codes', () => {
    expect(formatCode('TIER_DOWNGRADE')).toBe('Tier downgrade');
    expect(formatCode(null)).toBe('—');
  });

  it('round-trips local dates for date inputs', () => {
    const date = combineLocal('2026-03-05', '09:30');
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(30);
    expect(toDateInputValue(date)).toBe('2026-03-05');
  });

  it('computes peak overlap like the server (half-open intervals)', () => {
    const iso = (h: number) => new Date(Date.UTC(2026, 2, 1, h)).toISOString();
    const slots = [
      { start: iso(9), end: iso(10) },
      { start: iso(10), end: iso(11) },
      { start: iso(9), end: iso(11) },
    ];
    expect(peakOverlap(slots, new Date(iso(9)), new Date(iso(11)))).toBe(2);
    expect(peakOverlap(slots, new Date(iso(11)), new Date(iso(12)))).toBe(0);
  });
});
