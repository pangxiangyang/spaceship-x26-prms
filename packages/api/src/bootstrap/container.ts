import {
  createInMemoryRepositories,
  createPrmsDomain,
  type Clock,
  type IdGenerator,
  type PrmsDomain,
} from '@prms/domain';
import { AuthService } from '../auth/AuthService';
import { InMemoryCredentialStore } from '../auth/CredentialStore';
import { BcryptPasswordHasher, type PasswordHasher } from '../auth/PasswordHasher';
import { JwtTokenService, type TokenService } from '../auth/TokenService';
import type { AppConfig } from '../config';
import { OffsetClock } from './OffsetClock';
import { seedDemoData } from './seedDemoData';

export interface AppContainer {
  config: AppConfig;
  domain: PrmsDomain;
  auth: AuthService;
  tokens: TokenService;
}

export interface ContainerOverrides {
  clock?: Clock;
  ids?: IdGenerator;
  hasher?: PasswordHasher;
}

/**
 * Composition root for the API process. Swapping the in-memory repositories
 * for a database means changing only this function.
 */
export async function createContainer(
  config: AppConfig,
  overrides: ContainerOverrides = {},
): Promise<AppContainer> {
  const clock = new OffsetClock(overrides.clock);
  const domain = createPrmsDomain({
    repositories: createInMemoryRepositories(),
    clock,
    ...(overrides.ids ? { ids: overrides.ids } : {}),
  });
  const tokens = new JwtTokenService(config.jwtSecret, config.tokenTtlSeconds);
  const hasher = overrides.hasher ?? new BcryptPasswordHasher(config.bcryptCost);
  const auth = new AuthService(domain, new InMemoryCredentialStore(), hasher, tokens);

  for (const lead of config.crewLeads) {
    await auth.registerCrewLead(lead);
  }
  // Mission invariant: refuse to start without exactly three Crew Leads.
  await domain.crewLeads.assertRosterComplete();

  const container = { config, domain, auth, tokens };
  if (config.seedDemoData) {
    await seedDemoData(container, clock);
  }
  return container;
}
