import { combineLocal, toDateInputValue } from './format';

const MINUTES_PER_DAY = 24 * 60;
const STEP_MINUTES = 15;

/** Every quarter hour of a day, "00:00" to "23:45". */
export const START_TIMES: readonly string[] = Array.from(
  { length: MINUTES_PER_DAY / STEP_MINUTES },
  (_, i) => {
    const h = String(Math.floor((i * STEP_MINUTES) / 60)).padStart(2, '0');
    const m = String((i * STEP_MINUTES) % 60).padStart(2, '0');
    return `${h}:${m}`;
  },
);

/**
 * The first quarter hour that is still ahead of `now` (in local time). After 23:45
 * that is midnight tomorrow, not a time today that has already passed.
 */
export function defaultBookingStart(now: Date): { date: string; time: string } {
  const minutes =
    Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / STEP_MINUTES) * STEP_MINUTES;
  if (minutes >= MINUTES_PER_DAY) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { date: toDateInputValue(tomorrow), time: START_TIMES[0]! };
  }
  return { date: toDateInputValue(now), time: START_TIMES[minutes / STEP_MINUTES]! };
}

/** The start times that can still be booked on `date`: on today's date, only future ones. */
export function startTimesFor(date: string, now: Date): readonly string[] {
  if (date !== toDateInputValue(now)) return START_TIMES;
  return START_TIMES.filter((t) => combineLocal(date, t).getTime() > now.getTime());
}
