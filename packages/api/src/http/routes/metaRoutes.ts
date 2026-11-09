import { Router } from 'express';
import { ALL_RESOURCE_CATEGORIES, ALL_TIERS, DEFAULT_BOOKING_POLICY } from '@prms/domain';
import { demoAccounts } from '../../bootstrap/seedDemoData';
import type { AppConfig } from '../../config';

/** Static reference data the client needs to build forms. */
export function metaRoutes(config: AppConfig): Router {
  const router = Router();
  // Demo mode publishes its sign-in details so visitors can try every role.
  const demo =
    config.seedDemoData && config.crewLeads[0]
      ? { accounts: demoAccounts(config.crewLeads[0]) }
      : null;

  router.get('/', (_req, res) => {
    res.json({
      tiers: ALL_TIERS,
      categories: ALL_RESOURCE_CATEGORIES,
      bookingPolicy: DEFAULT_BOOKING_POLICY,
      demo,
    });
  });
  return router;
}
