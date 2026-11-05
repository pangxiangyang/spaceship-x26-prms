/** Tunable operating rules for bookings. */
export interface BookingPolicy {
  minDurationMinutes: number;
  maxDurationMinutes: number;
  /** How far ahead a slot may be booked. */
  maxAdvanceDays: number;
  /** How early before the slot starts a passenger may check in. */
  checkInLeadMinutes: number;
}

export const DEFAULT_BOOKING_POLICY: Readonly<BookingPolicy> = Object.freeze({
  minDurationMinutes: 15,
  maxDurationMinutes: 240,
  maxAdvanceDays: 14,
  checkInLeadMinutes: 15,
});
