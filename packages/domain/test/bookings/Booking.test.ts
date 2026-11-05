import { describe, expect, it } from 'vitest';
import { Booking } from '../../src/bookings/Booking';
import { TimeSlot } from '../../src/bookings/TimeSlot';
import { ConflictError } from '../../src/shared/errors';

const t = (hhmm: string) => new Date(`2026-03-01T${hhmm}:00Z`);
const newBooking = () =>
  Booking.create({
    id: 'b-1',
    passengerId: 'p-1',
    resourceId: 'r-1',
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
