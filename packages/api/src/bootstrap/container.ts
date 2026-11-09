import {
  createPrmsDomain,
  type BookingPolicy,
  type Clock,
  type IdGenerator,
  type PrmsDomain,
} from '@prms/domain';
import { AuthService } from '../auth/AuthService';
import { BcryptPasswordHasher, type PasswordHasher } from '../auth/PasswordHasher';
import { JwtTokenService, type TokenService } from '../auth/TokenService';
import type { AppConfig } from '../config';
import { createPersistence } from '../persistence/createPersistence';
import type { Persistence } from '../persistence/Persistence';
import { OffsetClock } from './OffsetClock';
import { seedDemoData } from './seedDemoData';

export interface AppContainer {
  config: AppConfig;
  domain: PrmsDomain;
  auth: AuthService;
  tokens: TokenService;
  persistence: Persistence;
}

export interface ContainerOverrides {
  clock?: Clock;
  ids?: IdGenerator;
  hasher?: PasswordHasher;
  /** Overrides individual booking rules (the defaults apply otherwise). */
  bookingPolicy?: Partial<BookingPolicy>;
  /** Defaults to the storage named in the configuration. */
  persistence?: Persistence;
}

/**
 * Composition root for the API process: chooses the storage, wires the domain
 * and account services, and brings the stored data up to the configured state.
 * Safe to run repeatedly against persistent storage.
 */
export async function createContainer(
  config: AppConfig,
  overrides: ContainerOverrides = {},
): Promise<AppContainer> {
  const persistence = overrides.persistence ?? createPersistence(config.storage);
  const clock = new OffsetClock(overrides.clock);
  const domain = createPrmsDomain({
    repositories: persistence.repositories,
    clock,
    ...(overrides.ids ? { ids: overrides.ids } : {}),
    ...(overrides.bookingPolicy ? { bookingPolicy: overrides.bookingPolicy } : {}),
  });
  const tokens = new JwtTokenService(config.jwtSecret, config.tokenTtlSeconds);
  const hasher = overrides.hasher ?? new BcryptPasswordHasher(config.bcryptCost);
  const auth = new AuthService(domain, persistence.credentials, hasher, tokens);

  for (const lead of config.crewLeads) {
    await auth.ensureCrewLead(lead);
  }
  // Mission invariant: refuse to start without exactly three Crew Leads.
  await domain.crewLeads.assertRosterComplete();

  const container = { config, domain, auth, tokens, persistence };
  // The marker guarantees one seeding per data set, however many instances start.
  if (config.seedDemoData && (await persistence.demoSeed.claim(clock.now()))) {
    await seedDemoData(container, clock);
  }
  return container;
}
