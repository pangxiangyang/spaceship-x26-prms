import { Router } from 'express';
import { z } from 'zod';
import {
  ALL_RESOURCE_CATEGORIES,
  ALL_TIERS,
  AuditAction,
  TimeSlot,
  type MembershipTier,
  type ResourceCategory,
} from '@prms/domain';
import type { AppContainer } from '../../bootstrap/container';
import { actorOf } from '../middleware/authenticate';
import {
  presentAuditEvent,
  presentHistoryEntry,
  presentResource,
  presentUser,
} from '../presenters';
import { idParam, isoDateTime, parse } from '../validation';

const DAY_MS = 24 * 60 * 60 * 1000;

const tier = z.enum(ALL_TIERS as [MembershipTier, ...MembershipTier[]]);
const category = z.enum(ALL_RESOURCE_CATEGORIES as [ResourceCategory, ...ResourceCategory[]]);

const createPassengerBody = z.object({
  username: z.string().max(64),
  displayName: z.string().max(200),
  tier,
  password: z.string().max(256),
});
const updatePassengerBody = z.object({ displayName: z.string().max(200) });
const tierBody = z.object({ tier });

const resourceBody = z.object({
  name: z.string().max(200),
  description: z.string().max(1000).optional(),
  category,
  minTier: tier,
  capacity: z.number().int(),
});
const resourceChangesBody = resourceBody
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, 'Provide at least one field to change.');

const auditQuery = z.object({
  action: z.nativeEnum(AuditAction).optional(),
  outcome: z.enum(['SUCCESS', 'DENIED']).optional(),
  actorId: z.string().max(64).optional(),
  subjectId: z.string().max(64).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const periodQuery = z.object({ from: isoDateTime.optional(), to: isoDateTime.optional() });

/** Crew Lead administration. Mounted behind `requireRole('CREW_LEAD')`. */
export function adminRoutes({ auth, domain }: AppContainer): Router {
  const router = Router();
  const now = () => domain.clock.now();

  /** Defaults to the last 7 days. */
  const periodFrom = (query: unknown) => {
    const { from, to } = parse(periodQuery, query);
    const end = to ?? now();
    return TimeSlot.of(from ?? new Date(end.getTime() - 7 * DAY_MS), end);
  };

  router.get('/crew-leads', async (_req, res) => {
    const leads = await domain.crewLeads.list(actorOf(res));
    res.json({ crewLeads: leads.map(presentUser) });
  });

  // Passenger profiles & tiers
  router.get('/passengers', async (_req, res) => {
    const passengers = await domain.passengers.list(actorOf(res));
    res.json({ passengers: passengers.map(presentUser) });
  });

  router.post('/passengers', async (req, res) => {
    const input = parse(createPassengerBody, req.body);
    const passenger = await auth.createPassengerAccount(actorOf(res), input);
    res.status(201).json({ passenger: presentUser(passenger) });
  });

  router.get('/passengers/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json({ passenger: presentUser(await domain.passengers.get(actorOf(res), id)) });
  });

  router.patch('/passengers/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { displayName } = parse(updatePassengerBody, req.body);
    const passenger = await domain.passengers.rename(actorOf(res), id, displayName);
    res.json({ passenger: presentUser(passenger) });
  });

  router.put('/passengers/:id/tier', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(tierBody, req.body);
    const result = await domain.passengers.changeTier(actorOf(res), id, body.tier);
    res.json({
      passenger: presentUser(result.passenger),
      change: result.change,
      revokedBookingIds: result.revokedBookingIds,
    });
  });

  router.get('/passengers/:id/history', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const history = await domain.reports.personalHistory(actorOf(res), id);
    res.json({
      passenger: presentUser(history.passenger),
      summary: history.summary,
      entries: history.entries.map((e) => presentHistoryEntry(e, now())),
    });
  });

  // Resource inventory
  router.get('/resources', async (_req, res) => {
    const resources = await domain.resources.listAll(actorOf(res));
    res.json({ resources: resources.map(presentResource) });
  });

  router.post('/resources', async (req, res) => {
    const spec = parse(resourceBody, req.body);
    const resource = await domain.resources.provision(actorOf(res), spec);
    res.status(201).json({ resource: presentResource(resource) });
  });

  router.patch('/resources/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const changes = parse(resourceChangesBody, req.body);
    const result = await domain.resources.update(actorOf(res), id, changes);
    res.json({
      resource: presentResource(result.resource),
      revokedBookingIds: result.revokedBookingIds,
    });
  });

  router.post('/resources/:id/decommission', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const result = await domain.resources.decommission(actorOf(res), id);
    res.json({
      resource: presentResource(result.resource),
      revokedBookingIds: result.revokedBookingIds,
    });
  });

  // Monitoring
  router.get('/audit', async (req, res) => {
    const actor = actorOf(res);
    const query = parse(auditQuery, req.query);
    const [page, passengers, leads] = await Promise.all([
      domain.audit.list(actor, query),
      domain.passengers.list(actor),
      domain.crewLeads.list(actor),
    ]);
    const names = new Map([...passengers, ...leads].map((u) => [u.id, u.displayName]));
    res.json({ total: page.total, events: page.items.map((e) => presentAuditEvent(e, names)) });
  });

  router.get('/reports/tier-usage', async (req, res) => {
    const period = periodFrom(req.query);
    const tiers = await domain.reports.usageByTier(actorOf(res), period);
    res.json({ period: presentPeriod(period), tiers });
  });

  router.get('/reports/resource-demand', async (req, res) => {
    const period = periodFrom(req.query);
    const resources = await domain.reports.resourceDemand(actorOf(res), period);
    res.json({ period: presentPeriod(period), resources });
  });

  return router;
}

const presentPeriod = (period: TimeSlot) => ({
  from: period.start.toISOString(),
  to: period.end.toISOString(),
});
