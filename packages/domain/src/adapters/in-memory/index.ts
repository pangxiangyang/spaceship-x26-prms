import { InMemoryAuditLog } from './InMemoryAuditLog';
import { InMemoryBookingRepository } from './InMemoryBookingRepository';
import { InMemoryResourceRepository } from './InMemoryResourceRepository';
import { InMemoryUserRepository } from './InMemoryUserRepository';
import type { PrmsRepositories } from '../../createPrmsDomain';

export {
  InMemoryAuditLog,
  InMemoryBookingRepository,
  InMemoryResourceRepository,
  InMemoryUserRepository,
};

export function createInMemoryRepositories(): PrmsRepositories {
  return {
    users: new InMemoryUserRepository(),
    resources: new InMemoryResourceRepository(),
    bookings: new InMemoryBookingRepository(),
    auditLog: new InMemoryAuditLog(),
  };
}
