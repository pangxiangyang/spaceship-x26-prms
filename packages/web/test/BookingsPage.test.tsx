import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Booking, Meta } from '../src/api/types';
import { AuthProvider } from '../src/auth/AuthContext';
import { BookingsPage } from '../src/pages/passenger/BookingsPage';
import { fakeApi } from './support/fakeApi';

const NOW = new Date('2026-03-05T09:00:00Z');
const inMinutes = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const upcoming = (startsInMinutes: number): Booking => ({
  id: 'b1',
  passengerId: 'p1',
  passengerTier: 'GOLD',
  resourceId: 'r1',
  resourceName: 'Private Cabin',
  category: 'CABIN',
  start: inMinutes(startsInMinutes),
  end: inMinutes(startsInMinutes + 60),
  durationMinutes: 60,
  status: 'CONFIRMED',
  lifecycle: 'UPCOMING',
  checkedInAt: null,
  cancelledAt: null,
  cancellationReason: null,
  createdAt: inMinutes(-60),
});

const meta = (checkInLeadMinutes: number): Meta => ({
  tiers: ['SILVER', 'GOLD', 'PLATINUM'],
  categories: ['CABIN'],
  bookingPolicy: {
    minDurationMinutes: 15,
    maxDurationMinutes: 240,
    maxAdvanceDays: 14,
    checkInLeadMinutes,
    maxActiveBookingsPerPassenger: 3,
  },
  demo: null,
});

function renderPage(booking: Booking, checkInLeadMinutes: number) {
  render(
    <AuthProvider
      client={fakeApi({
        '/api/bookings': { bookings: [booking] },
        '/api/meta': meta(checkInLeadMinutes),
      })}
    >
      <BookingsPage />
    </AuthProvider>,
  );
}

const checkInButton = async () => (await screen.findByText('Check in')).closest('button')!;

describe('BookingsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('opens check-in as early as the server policy allows', async () => {
    renderPage(upcoming(20), 30);
    expect(await checkInButton()).toBeEnabled();
  });

  it('explains when check-in opens, using the server policy', async () => {
    renderPage(upcoming(45), 30);
    const button = await checkInButton();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Check-in opens 30 minutes before the start');
  });
});
