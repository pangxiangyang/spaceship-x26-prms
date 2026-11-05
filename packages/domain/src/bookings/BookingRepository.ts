import type { Booking } from './Booking';

export interface BookingRepository {
  findById(id: string): Promise<Booking | undefined>;
  findByPassenger(passengerId: string): Promise<Booking[]>;
  findByResource(resourceId: string): Promise<Booking[]>;
  findAll(): Promise<Booking[]>;
  save(booking: Booking): Promise<void>;
}
