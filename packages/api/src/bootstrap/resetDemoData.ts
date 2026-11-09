import type { AppConfig } from '../config';
import { createPersistence } from '../persistence/createPersistence';
import { createContainer, type AppContainer, type ContainerOverrides } from './container';

/**
 * Restores a live demo to its starting state: deletes everything visitors
 * created or changed, then registers the Crew Leads and seeds a fresh week of
 * activity ending now. Refuses to run unless the environment is in demo mode,
 * so it can never wipe real data.
 */
export async function resetDemoData(
  config: AppConfig,
  overrides: ContainerOverrides = {},
): Promise<AppContainer> {
  if (!config.seedDemoData) {
    throw new Error('Refusing to reset: SEED_DEMO_DATA is off, so this is not a demo environment.');
  }
  const persistence = overrides.persistence ?? createPersistence(config.storage);
  await persistence.wipe();
  return createContainer(config, { ...overrides, persistence });
}
