import { resetDemoData } from '../bootstrap/resetDemoData';
import { loadConfig } from '../config';
import { jsonLogger as logger } from '../http/logger';

/**
 * One-off job: restore the live demo to a fresh state.
 * Runs as a Cloud Run job on a daily schedule, or locally with `npm run demo:reset`.
 */
async function main(): Promise<void> {
  const startedAt = Date.now();
  const config = loadConfig();
  logger.info('Resetting demo data', { storage: config.storage.kind });

  const { persistence } = await resetDemoData(config);
  const { users, resources, bookings } = persistence.repositories;
  logger.info('Demo data reset', {
    durationMs: Date.now() - startedAt,
    passengers: (await users.findPassengers()).length,
    resources: (await resources.findAll()).length,
    bookings: (await bookings.findAll()).length,
  });
  await persistence.close();
}

main().catch((error: unknown) => {
  logger.error('Demo reset failed', {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exit(1);
});
