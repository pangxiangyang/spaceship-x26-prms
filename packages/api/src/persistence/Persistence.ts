import type { PrmsRepositories, PrmsStorage, Transaction, UnitOfWork } from '@prms/domain';
import type { CredentialStore } from '../auth/CredentialStore';

/** Makes sure demo data is seeded by exactly one process, even across instances. */
export interface DemoSeedMarker {
  /** True for the first caller only, until the data is wiped. */
  claim(at: Date): Promise<boolean>;
}

/**
 * Everything the API stores, behind ports. The domain sees only the storage it needs
 * (repositories and units of work); the rest is used by the composition root, sign-in
 * and the demo reset.
 */
export interface Persistence extends PrmsStorage {
  readonly kind: 'memory' | 'firestore';
  readonly repositories: PrmsRepositories;
  readonly unitOfWork: UnitOfWork;
  /** Password hashes, read and written outside any unit of work. */
  readonly credentials: CredentialStore;
  /** Password hashes as part of unit of work `tx`, to store them with a new account. */
  credentialsIn(tx: Transaction): CredentialStore;
  readonly demoSeed: DemoSeedMarker;
  /** Deletes all stored data. Only the demo reset calls this. */
  wipe(): Promise<void>;
  /** Releases connections. */
  close(): Promise<void>;
}
