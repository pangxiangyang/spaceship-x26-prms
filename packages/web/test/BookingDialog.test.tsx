import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Occupancy, Resource } from '../src/api/types';
import { AuthProvider } from '../src/auth/AuthContext';
import { BookingDialog } from '../src/pages/passenger/BookingDialog';
import { fakeApi } from './support/fakeApi';

const cabin: Resource = {
  id: 'r1',
  name: 'Private Cabin',
  description: 'Quiet quarters',
  category: 'CABIN',
  minTier: 'GOLD',
  capacity: 4,
  status: 'ACTIVE',
  createdAt: '2026-03-01T00:00:00Z',
  decommissionedAt: null,
};

// Local times, as the dialog shows them.
const local = (day: number, hours: number, minutes = 0) => new Date(2026, 2, day, hours, minutes);

function renderDialog(resource: Resource, occupied: Occupancy['occupied'] = []) {
  const occupancy: Occupancy = { resourceId: resource.id, capacity: resource.capacity, occupied };
  return render(
    <AuthProvider client={fakeApi({ [`/api/resources/${resource.id}/occupancy`]: occupancy })}>
      <BookingDialog resource={resource} onClose={vi.fn()} onBooked={vi.fn()} />
    </AuthProvider>,
  );
}

const confirmButton = () => screen.getByText('Confirm booking').closest('button')!;

describe('BookingDialog', () => {
  beforeAll(() => {
    // jsdom has no modal dialogs: open the element so its contents are visible.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  });
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it('starts late-night bookings at midnight tomorrow, not at a time that has passed', async () => {
    vi.setSystemTime(local(5, 23, 50));
    renderDialog(cabin);
    expect(screen.getByLabelText('Date')).toHaveValue('2026-03-06');
    expect(screen.getByLabelText('Start')).toHaveValue('00:00');
  });

  it('offers only start times still ahead today', async () => {
    vi.setSystemTime(local(5, 22, 20));
    renderDialog(cabin);
    const options = [...(screen.getByLabelText('Start') as HTMLSelectElement).options];
    expect(options.map((o) => o.value)).toEqual([
      '22:30',
      '22:45',
      '23:00',
      '23:15',
      '23:30',
      '23:45',
    ]);
  });

  it('shows how many places are free for the chosen slot', async () => {
    vi.setSystemTime(local(5, 8, 50));
    renderDialog(cabin, [{ start: local(5, 9).toISOString(), end: local(5, 11).toISOString() }]);
    expect(await screen.findByText(/3 of 4 places free/)).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });

  it('disables Confirm when the chosen slot is fully booked', async () => {
    vi.setSystemTime(local(5, 8, 50));
    renderDialog({ ...cabin, capacity: 1 }, [
      { start: local(5, 9).toISOString(), end: local(5, 10).toISOString() },
    ]);
    expect(await screen.findByText(/Fully booked for part of this time/)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });
});
