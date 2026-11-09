import type { Booking } from './Booking';
import type { TimeSlot } from './TimeSlot';

/**
 * Persistence port for bookings. Use cases always ask for a time window, so the cost of
 * a query stays proportional to the bookings around that time, not to the whole mission.
 */
export interface BookingRepository {
  findById(id: string): Promise<Booking | undefined>;
  /** A passenger's bookings that overlap `window`, or all of them (their history). */
  findByPassenger(passengerId: string, window?: TimeSlot): Promise<Booking[]>;
  /** A resource's bookings that overlap `window`. */
  findByResource(resourceId: string, window: TimeSlot): Promise<Booking[]>;
  /** Every booking that overlaps `window`. */
  findOverlapping(window: TimeSlot): Promise<Booking[]>;
  /** Every booking ever made: a full scan, for maintenance and tests only. */
  findAll(): Promise<Booking[]>;
  save(booking: Booking): Promise<void>;
}
