import type { PrmsRepositories } from '@prms/domain';
import type { CredentialStore } from '../auth/CredentialStore';

/** Makes sure demo data is seeded by exactly one process, even across instances. */
export interface DemoSeedMarker {
  /** True for the first caller only, until the data is wiped. */
  claim(at: Date): Promise<boolean>;
}

/**
 * Everything the API stores, behind ports. The domain sees only the
 * repositories; the rest is used by the composition root and the demo reset.
 */
export interface Persistence {
  readonly kind: 'memory' | 'firestore';
  readonly repositories: PrmsRepositories;
  readonly credentials: CredentialStore;
  readonly demoSeed: DemoSeedMarker;
  /** Deletes all stored data. Only the demo reset calls this. */
  wipe(): Promise<void>;
  /** Releases connections. */
  close(): Promise<void>;
}
