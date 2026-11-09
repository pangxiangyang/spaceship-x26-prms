import { describe, expect, it } from 'vitest';
import { createInMemoryRepositories } from '../src/adapters/in-memory';
import { DEFAULT_BOOKING_POLICY } from '../src/bookings/BookingPolicy';
import { createPrmsDomain } from '../src/createPrmsDomain';

describe('createPrmsDomain', () => {
  it('exposes the booking policy it enforces, read-only', () => {
    const domain = createPrmsDomain({
      repositories: createInMemoryRepositories(),
      bookingPolicy: { checkInLeadMinutes: 30 },
    });
    expect(domain.bookingPolicy).toEqual({ ...DEFAULT_BOOKING_POLICY, checkInLeadMinutes: 30 });
    expect(Object.isFrozen(domain.bookingPolicy)).toBe(true);
  });
});
