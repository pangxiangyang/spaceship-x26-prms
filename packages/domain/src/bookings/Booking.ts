import { isMembershipTier, type MembershipTier } from '../membership/MembershipTier';
import { ConflictError, ValidationError } from '../shared/errors';
import { TimeSlot } from './TimeSlot';

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

/** Plain-data form of a booking, for persistence adapters. */
export interface BookingSnapshot {
  id: string;
  passengerId: string;
  resourceId: string;
  passengerTier: MembershipTier;
  start: Date;
  end: Date;
  createdAt: Date;
  status: BookingStatus;
  checkedInAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: CancellationReason | null;
}

const isCancellationReason = (value: unknown): value is CancellationReason =>
  Object.values(CancellationReason).includes(value as CancellationReason);

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

  /** Rebuilds a stored booking, re-validating it so corrupt data cannot enter the domain. */
  static restore(snapshot: BookingSnapshot): Booking {
    const corrupt = (reason: string) =>
      new ValidationError(`Stored booking '${snapshot.id}' is invalid: ${reason}.`);
    if (!isMembershipTier(snapshot.passengerTier)) throw corrupt('unknown passenger tier');

    const booking = new Booking({ ...snapshot, slot: TimeSlot.of(snapshot.start, snapshot.end) });
    switch (snapshot.status) {
      case BookingStatus.CONFIRMED:
        break;
      case BookingStatus.CHECKED_IN:
        if (!snapshot.checkedInAt) throw corrupt('checked in without a check-in time');
        booking._status = BookingStatus.CHECKED_IN;
        booking._checkedInAt = snapshot.checkedInAt;
        break;
      case BookingStatus.CANCELLED:
        if (!snapshot.cancelledAt || !isCancellationReason(snapshot.cancellationReason)) {
          throw corrupt('cancelled without a time and reason');
        }
        booking._status = BookingStatus.CANCELLED;
        booking._cancelledAt = snapshot.cancelledAt;
        booking._cancellationReason = snapshot.cancellationReason;
        break;
      default:
        throw corrupt(`unknown status '${String(snapshot.status)}'`);
    }
    return booking;
  }

  toSnapshot(): BookingSnapshot {
    return {
      id: this.id,
      passengerId: this.passengerId,
      resourceId: this.resourceId,
      passengerTier: this.passengerTier,
      start: this.slot.start,
      end: this.slot.end,
      createdAt: this.createdAt,
      status: this._status,
      checkedInAt: this._checkedInAt ?? null,
      cancelledAt: this._cancelledAt ?? null,
      cancellationReason: this._cancellationReason ?? null,
    };
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
