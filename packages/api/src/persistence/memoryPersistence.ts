import {
  InMemoryAuditLog,
  InMemoryBookingRepository,
  InMemoryResourceRepository,
  InMemoryUserRepository,
} from '@prms/domain';
import { InMemoryCredentialStore } from '../auth/CredentialStore';
import type { Persistence } from './Persistence';

/** Process-local storage: used for development and tests. Data is lost on restart. */
export function createMemoryPersistence(): Persistence {
  const users = new InMemoryUserRepository();
  const resources = new InMemoryResourceRepository();
  const bookings = new InMemoryBookingRepository();
  const auditLog = new InMemoryAuditLog();
  const credentials = new InMemoryCredentialStore();
  let seeded = false;

  return {
    kind: 'memory',
    repositories: { users, resources, bookings, auditLog },
    credentials,
    demoSeed: {
      claim: async () => {
        if (seeded) return false;
        seeded = true;
        return true;
      },
    },
    wipe: async () => {
      users.clear();
      resources.clear();
      bookings.clear();
      auditLog.clear();
      credentials.clear();
      seeded = false;
    },
    close: async () => {},
  };
}
