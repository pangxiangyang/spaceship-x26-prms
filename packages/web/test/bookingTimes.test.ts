import { describe, expect, it } from 'vitest';
import { defaultBookingStart, startTimesFor } from '../src/lib/bookingTimes';

// Local times, like the booking dialog uses.
const local = (day: number, hours: number, minutes: number) =>
  new Date(2026, 2, day, hours, minutes);

describe('booking start times', () => {
  it('defaults to the next quarter hour today', () => {
    expect(defaultBookingStart(local(5, 9, 7))).toEqual({ date: '2026-03-05', time: '09:15' });
    // Exactly on a quarter hour, that slot is already starting: offer the next one.
    expect(defaultBookingStart(local(5, 9, 0))).toEqual({ date: '2026-03-05', time: '09:15' });
  });

  it('defaults to tomorrow at midnight when no quarter hour is left today', () => {
    expect(defaultBookingStart(local(5, 23, 50))).toEqual({ date: '2026-03-06', time: '00:00' });
    expect(defaultBookingStart(local(31, 23, 46))).toEqual({ date: '2026-04-01', time: '00:00' });
  });

  it('offers only start times that have not passed yet today', () => {
    const now = local(5, 22, 20);
    expect(startTimesFor('2026-03-05', now)).toEqual([
      '22:30',
      '22:45',
      '23:00',
      '23:15',
      '23:30',
      '23:45',
    ]);
    expect(startTimesFor('2026-03-06', now)).toHaveLength(96);
    expect(startTimesFor('2026-03-05', local(5, 23, 50))).toEqual([]);
  });
});
