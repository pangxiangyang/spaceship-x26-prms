import type { AuditTrail } from '../audit/AuditTrail';
import type { Actor } from '../identity/Actor';
import type { Clock } from '../shared/ports';
import type { Transaction } from '../shared/UnitOfWork';
import type { Booking, CancellationReason } from './Booking';

/**
 * Cancels bookings that an administrative change has made invalid (a tier
 * downgrade, a resource being decommissioned or moved to a higher tier).
 *
 * Only bookings that are still pending are revoked. Sessions already in progress
 * are allowed to finish — interrupting someone mid-use of a life-support
 * resource is never the safe default. Runs inside the caller's unit of work, so the
 * revocations commit together with the change that caused them, or not at all.
 */
export class BookingRevocation {
  constructor(
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async revokePending(
    tx: Transaction,
    actor: Actor,
    candidates: readonly Booking[],
    reason: CancellationReason,
  ): Promise<Booking[]> {
    const now = this.clock.now();
    const revoked: Booking[] = [];
    for (const booking of candidates) {
      if (!booking.isPending(now)) continue;
      booking.cancel(now, reason);
      await tx.bookings.save(booking);
      await this.audit.append(tx, {
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
