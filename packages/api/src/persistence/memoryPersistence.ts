import { createInMemoryStorage, type Transaction, type UnitOfWork } from '@prms/domain';
import { InMemoryCredentialStore, type CredentialStore } from '../auth/CredentialStore';
import type { Persistence } from './Persistence';

/** Process-local storage: used for development and tests. Data is lost on restart. */
export function createMemoryPersistence(): Persistence {
  const storage = createInMemoryStorage();
  const credentials = new InMemoryCredentialStore();
  /** Credential writes of each running unit of work, applied when its work succeeds. */
  const pending = new WeakMap<Transaction, Map<string, string>>();
  let seeded = false;

  // The domain store applies its writes synchronously right after `work` returns, so
  // applying the credential writes at that point makes them commit or fail together.
  const unitOfWork: UnitOfWork = {
    run: (work) =>
      storage.unitOfWork.run(async (inner) => {
        const tx: Transaction = { ...inner };
        const writes = new Map<string, string>();
        pending.set(tx, writes);
        const result = await work(tx);
        for (const [userId, hash] of writes) await credentials.setPasswordHash(userId, hash);
        return result;
      }),
  };

  return {
    kind: 'memory',
    repositories: storage.repositories,
    unitOfWork,
    credentials,
    credentialsIn: (tx): CredentialStore => {
      const writes = pending.get(tx);
      if (!writes) throw new Error('Not a unit of work of this storage.');
      return {
        setPasswordHash: async (userId, hash) => void writes.set(userId, hash),
        getPasswordHash: (userId) => credentials.getPasswordHash(userId),
      };
    },
    demoSeed: {
      claim: async () => {
        if (seeded) return false;
        seeded = true;
        return true;
      },
    },
    ping: async () => {},
    wipe: async () => {
      storage.clear();
      credentials.clear();
      seeded = false;
    },
    close: async () => {},
  };
}
