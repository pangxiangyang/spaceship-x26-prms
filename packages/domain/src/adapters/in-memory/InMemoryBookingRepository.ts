import type { Booking } from '../../bookings/Booking';
import type { BookingRepository } from '../../bookings/BookingRepository';

export class InMemoryBookingRepository implements BookingRepository {
  private readonly byId = new Map<string, Booking>();

  /** Removes everything. Used by the demo reset. */
  clear(): void {
    this.byId.clear();
  }

  async findById(id: string): Promise<Booking | undefined> {
    return this.byId.get(id);
  }

  async findByPassenger(passengerId: string): Promise<Booking[]> {
    return [...this.byId.values()].filter((b) => b.passengerId === passengerId);
  }

  async findByResource(resourceId: string): Promise<Booking[]> {
    return [...this.byId.values()].filter((b) => b.resourceId === resourceId);
  }

  async findAll(): Promise<Booking[]> {
    return [...this.byId.values()];
  }

  async save(booking: Booking): Promise<void> {
    this.byId.set(booking.id, booking);
  }
}
