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

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const TIMES = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

function nextQuarterHour(now = new Date()): string {
  const minutes = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 15) * 15;
  return TIMES[Math.min(minutes / 15, TIMES.length - 1)]!;
}

interface Props {
  resource: Resource;
  onClose: () => void;
  onBooked: (booking: Booking) => void;
}

export function BookingDialog({ resource, onClose, onBooked }: Props) {
  const { api } = useAuth();
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [time, setTime] = useState(() => nextQuarterHour());
  const [duration, setDuration] = useState(60);

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
              {TIMES.map((t) => (
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

        <div className={`availability ${full ? 'is-full' : ''}`} aria-live="polite">
          {occupancy.loading ? (
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
          <button type="submit" className="button primary" disabled={book.pending || full}>
            {book.pending ? 'Booking…' : 'Confirm booking'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
