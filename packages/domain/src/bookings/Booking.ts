import type { MembershipTier } from '../membership/MembershipTier';
import { ConflictError } from '../shared/errors';
import type { TimeSlot } from './TimeSlot';

export const BookingStatus = {
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  CANCELLED: 'CANCELLED',
} as const;

export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const CancellationReason = {
  PASSENGER_REQUEST: 'PASSENGER_REQUEST',
  CREW_LEAD_REQUEST: 'CREW_LEAD_REQUEST',
  TIER_DOWNGRADE: 'TIER_DOWNGRADE',
  RESOURCE_TIER_RAISED: 'RESOURCE_TIER_RAISED',
  RESOURCE_DECOMMISSIONED: 'RESOURCE_DECOMMISSIONED',
} as const;

export type CancellationReason = (typeof CancellationReason)[keyof typeof CancellationReason];

/** A time-aware view of a booking, derived from its status and the clock. */
export type BookingLifecycle = 'UPCOMING' | 'IN_PROGRESS' | 'COMPLETED' | 'MISSED' | 'CANCELLED';

export interface BookingProps {
  id: string;
  passengerId: string;
  resourceId: string;
  /** The passenger's tier when the booking was made — reports group by this. */
  passengerTier: MembershipTier;
  slot: TimeSlot;
  createdAt: Date;
}

/**
 * A passenger's reservation of a resource for a time slot.
 *
 * CONFIRMED ──checkIn──▶ CHECKED_IN   (usage has started)
 *     └──────cancel────▶ CANCELLED
 */
export class Booking {
  readonly id: string;
  readonly passengerId: string;
  readonly resourceId: string;
  readonly passengerTier: MembershipTier;
  readonly slot: TimeSlot;
  readonly createdAt: Date;
  private _status: BookingStatus = BookingStatus.CONFIRMED;
  private _checkedInAt: Date | undefined;
  private _cancelledAt: Date | undefined;
  private _cancellationReason: CancellationReason | undefined;

  private constructor(props: BookingProps) {
    this.id = props.id;
    this.passengerId = props.passengerId;
    this.resourceId = props.resourceId;
    this.passengerTier = props.passengerTier;
    this.slot = props.slot;
    this.createdAt = props.createdAt;
  }

  static create(props: BookingProps): Booking {
    return new Booking(props);
  }

  get status(): BookingStatus {
    return this._status;
  }
  get checkedInAt(): Date | undefined {
    return this._checkedInAt;
  }
  get cancelledAt(): Date | undefined {
    return this._cancelledAt;
  }
  get cancellationReason(): CancellationReason | undefined {
    return this._cancellationReason;
  }

  /** Whether the booking holds a seat on the resource during its slot. */
  get occupiesCapacity(): boolean {
    return this._status !== BookingStatus.CANCELLED;
  }

  /** Confirmed and not yet over — i.e. still something that can be cancelled. */
  isPending(now: Date): boolean {
    return this._status === BookingStatus.CONFIRMED && !this.slot.hasEnded(now);
  }

  cancel(at: Date, reason: CancellationReason): void {
    if (this._status !== BookingStatus.CONFIRMED) {
      throw new ConflictError(
        'INVALID_STATE',
        `Only confirmed bookings can be cancelled; this booking is ${this._status}.`,
      );
    }
    if (this.slot.hasEnded(at)) {
      throw new ConflictError('INVALID_STATE', 'This booking has already ended.');
    }
    this._status = BookingStatus.CANCELLED;
    this._cancelledAt = at;
    this._cancellationReason = reason;
  }

  /** Starts usage. Allowed from `leadMinutes` before the slot until the slot ends. */
  checkIn(at: Date, leadMinutes: number): void {
    if (this._status !== BookingStatus.CONFIRMED) {
      throw new ConflictError(
        'INVALID_STATE',
        `Only confirmed bookings can be checked in; this booking is ${this._status}.`,
      );
    }
    const opensAt = this.slot.start.getTime() - leadMinutes * 60_000;
    if (at.getTime() < opensAt) {
      throw new ConflictError(
        'INVALID_STATE',
        `Check-in opens ${leadMinutes} minutes before the booking starts.`,
      );
    }
    if (this.slot.hasEnded(at)) {
      throw new ConflictError('INVALID_STATE', 'This booking has already ended.');
    }
    this._status = BookingStatus.CHECKED_IN;
    this._checkedInAt = at;
  }

  lifecycle(now: Date): BookingLifecycle {
    switch (this._status) {
      case BookingStatus.CANCELLED:
        return 'CANCELLED';
      case BookingStatus.CHECKED_IN:
        return this.slot.hasEnded(now) ? 'COMPLETED' : 'IN_PROGRESS';
      case BookingStatus.CONFIRMED:
        return this.slot.hasEnded(now) ? 'MISSED' : 'UPCOMING';
    }
  }

  /** Minutes of actual resource usage: the booked duration once checked in. */
  get usedMinutes(): number {
    return this._status === BookingStatus.CHECKED_IN ? this.slot.durationMinutes : 0;
  }
}
