import { Router } from 'express';
import { ALL_RESOURCE_CATEGORIES, ALL_TIERS } from '@prms/domain';
import type { AppContainer } from '../../bootstrap/container';
import { demoAccounts } from '../../bootstrap/seedDemoData';

/** Reference data the client needs to build forms, including the rules in force. */
export function metaRoutes({ config, domain }: AppContainer): Router {
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
      bookingPolicy: domain.bookingPolicy,
      demo,
    });
  });
  return router;
}
