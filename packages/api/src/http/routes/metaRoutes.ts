import { Router } from 'express';
import { ALL_RESOURCE_CATEGORIES, ALL_TIERS, DEFAULT_BOOKING_POLICY } from '@prms/domain';

/** Static reference data the client needs to build forms. */
export function metaRoutes(): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json({
      tiers: ALL_TIERS,
      categories: ALL_RESOURCE_CATEGORIES,
      bookingPolicy: DEFAULT_BOOKING_POLICY,
    });
  });
  return router;
}
