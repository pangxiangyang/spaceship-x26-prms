import { useState, type FormEvent } from 'react';
import type { Booking, Occupancy, Resource } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { ErrorBanner, Modal } from '../../components/ui';
import { useAction, useApiData } from '../../hooks/useApiData';
import {
  combineLocal,
  formatMinutes,
  formatTime,
  peakOverlap,
  toDateInputValue,
} from '../../lib/format';
import { defaultBookingStart, startTimesFor } from '../../lib/bookingTimes';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

interface Props {
  resource: Resource;
  onClose: () => void;
  onBooked: (booking: Booking) => void;
}

export function BookingDialog({ resource, onClose, onBooked }: Props) {
  const { api } = useAuth();
  const [initial] = useState(() => defaultBookingStart(new Date()));
  const [date, setDate] = useState(initial.date);
  const [chosenTime, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(60);

  // On today's date only times still ahead are offered; keep the choice within them.
  const times = startTimesFor(date, new Date());
  const time = times.includes(chosenTime) ? chosenTime : (times[0] ?? chosenTime);
  const noTimesLeft = times.length === 0;

  const dayStart = combineLocal(date, '00:00');
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const occupancy = useApiData(
    (client) =>
      client.get<Occupancy>(`/api/resources/${resource.id}/occupancy`, {
        from: dayStart.toISOString(),
        to: dayEnd.toISOString(),
      }),
    [resource.id, date],
  );

  const start = combineLocal(date, time);
  const end = new Date(start.getTime() + duration * 60_000);
  const busiest = occupancy.data ? peakOverlap(occupancy.data.occupied, start, end) : 0;
  const full = busiest >= resource.capacity;

  const book = useAction(async () => {
    const result = await api.post<{ booking: Booking }>('/api/bookings', {
      resourceId: resource.id,
      start: start.toISOString(),
      end: end.toISOString(),
    });
    onBooked(result.booking);
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void book.run();
  };

  return (
    <Modal title={`Book ${resource.name}`} open onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label>
            Date
            <input
              type="date"
              value={date}
              min={toDateInputValue(new Date())}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>
          <label>
            Start
            <select value={time} onChange={(e) => setTime(e.target.value)}>
              {times.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Duration
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {formatMinutes(d)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={`availability ${full || noTimesLeft ? 'is-full' : ''}`} aria-live="polite">
          {noTimesLeft ? (
            <>No start times are left today. Pick another date.</>
          ) : occupancy.loading ? (
            'Checking availability…'
          ) : full ? (
            <>Fully booked for part of this time. Try another slot.</>
          ) : (
            <>
              {resource.capacity - busiest} of {resource.capacity} place
              {resource.capacity === 1 ? '' : 's'} free for {formatTime(start.toISOString())}–
              {formatTime(end.toISOString())}
            </>
          )}
        </div>

        {occupancy.data && occupancy.data.occupied.length > 0 && (
          <details>
            <summary className="muted">
              Booked times on this day ({occupancy.data.occupied.length})
            </summary>
            <ul className="slot-list">
              {occupancy.data.occupied.map((slot, i) => (
                <li key={i}>
                  {formatTime(slot.start)}–{formatTime(slot.end)}
                </li>
              ))}
            </ul>
          </details>
        )}

        <ErrorBanner error={book.error} />
        <div className="form-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={book.pending || full || noTimesLeft}
          >
            {book.pending ? 'Booking…' : 'Confirm booking'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
