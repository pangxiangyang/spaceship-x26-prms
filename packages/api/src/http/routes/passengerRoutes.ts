import { Router } from 'express';
import { z } from 'zod';
import { TimeSlot, ValidationError } from '@prms/domain';
import type { AppContainer } from '../../bootstrap/container';
import { actorOf, userOf } from '../middleware/authenticate';
import { presentBooking, presentHistoryEntry, presentResource, presentUser } from '../presenters';
import { idParam, isoDateTime, parse } from '../validation';

const MAX_OCCUPANCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const bookingBody = z.object({
  resourceId: z.string().min(1).max(64),
  start: isoDateTime,
  end: isoDateTime,
});

const windowQuery = z.object({ from: isoDateTime, to: isoDateTime });

/** Routes available to any signed-in user; the domain decides what each role may see. */
export function passengerRoutes({ domain }: AppContainer): Router {
  const router = Router();
  const now = () => domain.clock.now();

  router.get('/me', async (_req, res) => {
    res.json({ user: presentUser(userOf(res)) });
  });

  // Resource discovery
  router.get('/resources', async (_req, res) => {
    const resources = await domain.resources.listAccessible(actorOf(res));
    res.json({ resources: resources.map(presentResource) });
  });

  router.get('/resources/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json({ resource: presentResource(await domain.resources.get(actorOf(res), id)) });
  });

  router.get('/resources/:id/occupancy', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { from, to } = parse(windowQuery, req.query);
    if (to.getTime() - from.getTime() > MAX_OCCUPANCY_WINDOW_MS) {
      throw new ValidationError('Occupancy can be requested for at most 7 days at a time.');
    }
    const occupancy = await domain.bookings.occupancy(actorOf(res), id, TimeSlot.of(from, to));
    res.json({
      resourceId: occupancy.resource.id,
      capacity: occupancy.resource.capacity,
      occupied: occupancy.occupied.map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
      })),
    });
  });

  // Bookings (active usage)
  router.get('/bookings', async (_req, res) => {
    const actor = actorOf(res);
    const history = await domain.reports.personalHistory(actor, actor.userId);
    res.json({ bookings: history.entries.map((e) => presentHistoryEntry(e, now())) });
  });

  router.post('/bookings', async (req, res) => {
    const input = parse(bookingBody, req.body);
    const actor = actorOf(res);
    // Present the resource checked inside the booking: asking again could be refused if a
    // Crew Lead changed access in between, although the booking already exists.
    const { booking, resource } = await domain.bookings.book(actor, input);
    res.status(201).json({ booking: presentBooking(booking, now(), resource) });
  });

  router.post('/bookings/:id/cancel', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const booking = await domain.bookings.cancel(actorOf(res), id);
    res.json({ booking: presentBooking(booking, now()) });
  });

  router.post('/bookings/:id/check-in', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const booking = await domain.bookings.checkIn(actorOf(res), id);
    res.json({ booking: presentBooking(booking, now()) });
  });

  // Personal history
  router.get('/history', async (_req, res) => {
    const actor = actorOf(res);
    const history = await domain.reports.personalHistory(actor, actor.userId);
    res.json({
      summary: history.summary,
      entries: history.entries.map((e) => presentHistoryEntry(e, now())),
    });
  });

  return router;
}
