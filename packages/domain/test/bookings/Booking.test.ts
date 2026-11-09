import { describe, expect, it } from 'vitest';
import { Booking } from '../../src/bookings/Booking';
import { TimeSlot } from '../../src/bookings/TimeSlot';
import { ConflictError, ValidationError } from '../../src/shared/errors';

const t = (hhmm: string) => new Date(`2026-03-01T${hhmm}:00Z`);
const newBooking = () =>
  Booking.create({
    id: 'b-1',
    passengerId: 'p-1',
    resourceId: 'r-1',
    passengerTier: 'SILVER',
    slot: TimeSlot.of(t('10:00'), t('11:00')),
    createdAt: t('08:00'),
  });

describe('Booking', () => {
  it('starts confirmed and occupies capacity', () => {
    const booking = newBooking();
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.occupiesCapacity).toBe(true);
    expect(booking.lifecycle(t('09:00'))).toBe('UPCOMING');
  });

  describe('cancel', () => {
    it('frees capacity and records the reason', () => {
      const booking = newBooking();
      booking.cancel(t('09:00'), 'PASSENGER_REQUEST');
      expect(booking.status).toBe('CANCELLED');
      expect(booking.occupiesCapacity).toBe(false);
      expect(booking.cancellationReason).toBe('PASSENGER_REQUEST');
      expect(booking.cancelledAt).toEqual(t('09:00'));
    });

    it('cannot cancel twice, after check-in, or after the slot ended', () => {
      const cancelled = newBooking();
      cancelled.cancel(t('09:00'), 'PASSENGER_REQUEST');
      expect(() => cancelled.cancel(t('09:01'), 'PASSENGER_REQUEST')).toThrow(ConflictError);

      const checkedIn = newBooking();
      checkedIn.checkIn(t('10:00'), 15);
      expect(() => checkedIn.cancel(t('10:05'), 'PASSENGER_REQUEST')).toThrow(ConflictError);

      expect(() => newBooking().cancel(t('11:00'), 'PASSENGER_REQUEST')).toThrow(ConflictError);
    });
  });

  describe('checkIn', () => {
    it('opens the configured number of minutes before the slot', () => {
      expect(() => newBooking().checkIn(t('09:44'), 15)).toThrow(/opens 15 minutes/);
      const booking = newBooking();
      booking.checkIn(t('09:45'), 15);
      expect(booking.status).toBe('CHECKED_IN');
      expect(booking.checkedInAt).toEqual(t('09:45'));
    });

    it('is refused once the slot has ended or if already checked in', () => {
      expect(() => newBooking().checkIn(t('11:00'), 15)).toThrow(/already ended/);
      const booking = newBooking();
      booking.checkIn(t('10:00'), 15);
      expect(() => booking.checkIn(t('10:10'), 15)).toThrow(ConflictError);
    });
  });

  it('derives a lifecycle from status and time', () => {
    const missed = newBooking();
    expect(missed.lifecycle(t('11:00'))).toBe('MISSED');

    const used = newBooking();
    used.checkIn(t('10:00'), 15);
    expect(used.lifecycle(t('10:30'))).toBe('IN_PROGRESS');
    expect(used.lifecycle(t('11:00'))).toBe('COMPLETED');
    expect(used.usedMinutes).toBe(60);
    expect(missed.usedMinutes).toBe(0);
  });
});

describe('Booking snapshots (persistence)', () => {
  it('round-trips a confirmed booking as plain data', () => {
    const snapshot = newBooking().toSnapshot();
    expect(snapshot).toEqual({
      id: 'b-1',
      passengerId: 'p-1',
      resourceId: 'r-1',
      passengerTier: 'SILVER',
      start: t('10:00'),
      end: t('11:00'),
      createdAt: t('08:00'),
      status: 'CONFIRMED',
      checkedInAt: null,
      cancelledAt: null,
      cancellationReason: null,
    });
    expect(Booking.restore(snapshot).toSnapshot()).toEqual(snapshot);
  });

  it('round-trips checked-in and cancelled bookings with their behaviour intact', () => {
    const used = newBooking();
    used.checkIn(t('10:00'), 15);
    const restoredUsed = Booking.restore(used.toSnapshot());
    expect(restoredUsed.lifecycle(t('11:00'))).toBe('COMPLETED');
    expect(restoredUsed.usedMinutes).toBe(60);

    const cancelled = newBooking();
    cancelled.cancel(t('09:00'), 'TIER_DOWNGRADE');
    const restoredCancelled = Booking.restore(cancelled.toSnapshot());
    expect(restoredCancelled.occupiesCapacity).toBe(false);
    expect(restoredCancelled.cancellationReason).toBe('TIER_DOWNGRADE');
    expect(() => restoredCancelled.cancel(t('09:30'), 'PASSENGER_REQUEST')).toThrow(ConflictError);
  });

  it('rejects corrupt stored data', () => {
    const snapshot = newBooking().toSnapshot();
    const corrupt = [
      { status: 'LOST' },
      { status: 'CHECKED_IN', checkedInAt: null },
      { status: 'CANCELLED', cancelledAt: t('09:00'), cancellationReason: null },
      { passengerTier: 'BRONZE' },
      { end: t('09:00') },
    ];
    for (const override of corrupt) {
      expect(() => Booking.restore({ ...snapshot, ...override } as never)).toThrow(ValidationError);
    }
  });
});
