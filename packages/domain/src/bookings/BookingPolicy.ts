/** Tunable operating rules for bookings. */
export interface BookingPolicy {
  minDurationMinutes: number;
  maxDurationMinutes: number;
  /** How far ahead a slot may be booked. */
  maxAdvanceDays: number;
  /** How early before the slot starts a passenger may check in. */
  checkInLeadMinutes: number;
  /**
   * How many current bookings (active and not ended yet: upcoming or in progress) a
   * passenger may hold across all resources, so nobody can reserve a scarce resource for days.
   */
  maxCurrentBookingsPerPassenger: number;
}

export const DEFAULT_BOOKING_POLICY: Readonly<BookingPolicy> = Object.freeze({
  minDurationMinutes: 15,
  maxDurationMinutes: 240,
  maxAdvanceDays: 14,
  checkInLeadMinutes: 15,
  maxCurrentBookingsPerPassenger: 3,
});
