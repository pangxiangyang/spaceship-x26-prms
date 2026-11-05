import type { AuditTrail } from '../audit/AuditTrail';
import type { Actor } from '../identity/Actor';
import type { Clock } from '../shared/ports';
import type { Booking, CancellationReason } from './Booking';
import type { BookingRepository } from './BookingRepository';

/**
 * Cancels bookings that an administrative change has made invalid (a tier
 * downgrade, a resource being decommissioned or moved to a higher tier).
 *
 * Only bookings that are still pending are revoked. Sessions already in progress
 * are allowed to finish — interrupting someone mid-use of a life-support
 * resource is never the safe default. Callers must hold the booking lock.
 */
export class BookingRevocation {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async revokePending(
    actor: Actor,
    candidates: readonly Booking[],
    reason: CancellationReason,
  ): Promise<Booking[]> {
    const now = this.clock.now();
    const revoked: Booking[] = [];
    for (const booking of candidates) {
      if (!booking.isPending(now)) continue;
      booking.cancel(now, reason);
      await this.bookings.save(booking);
      await this.audit.record({
        actor,
        action: 'BOOKING_CANCEL',
        subject: { type: 'BOOKING', id: booking.id },
        details: { reason, passengerId: booking.passengerId, resourceId: booking.resourceId },
      });
      revoked.push(booking);
    }
    return revoked;
  }
}
