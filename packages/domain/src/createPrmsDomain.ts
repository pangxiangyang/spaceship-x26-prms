import type { AuditLog } from './audit/AuditLog';
import { AuditService } from './audit/AuditService';
import { AuditTrail } from './audit/AuditTrail';
import { DEFAULT_BOOKING_POLICY, type BookingPolicy } from './bookings/BookingPolicy';
import type { BookingRepository } from './bookings/BookingRepository';
import { BookingRevocation } from './bookings/BookingRevocation';
import { BookingService } from './bookings/BookingService';
import type { ResourceRepository } from './resources/ResourceRepository';
import { ResourceService } from './resources/ResourceService';
import { AsyncMutex } from './shared/AsyncMutex';
import { systemClock, uuidGenerator, type Clock, type IdGenerator } from './shared/ports';
import { CrewLeadService } from './users/CrewLeadService';
import { PassengerService } from './users/PassengerService';
import type { UserRepository } from './users/UserRepository';

export interface PrmsRepositories {
  users: UserRepository;
  resources: ResourceRepository;
  bookings: BookingRepository;
  auditLog: AuditLog;
}

export interface PrmsDomainOptions {
  repositories: PrmsRepositories;
  clock?: Clock;
  ids?: IdGenerator;
  bookingPolicy?: Partial<BookingPolicy>;
}

export interface PrmsDomain {
  crewLeads: CrewLeadService;
  passengers: PassengerService;
  resources: ResourceService;
  bookings: BookingService;
  audit: AuditService;
  repositories: PrmsRepositories;
  clock: Clock;
}

/** Composition root for the domain: wires services to their collaborators. */
export function createPrmsDomain(options: PrmsDomainOptions): PrmsDomain {
  const { repositories } = options;
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? uuidGenerator;
  const policy: BookingPolicy = { ...DEFAULT_BOOKING_POLICY, ...options.bookingPolicy };

  // One lock guards every operation that reads and then changes booking state.
  const bookingLock = new AsyncMutex();
  const auditTrail = new AuditTrail(repositories.auditLog, clock, ids);
  const revocation = new BookingRevocation(repositories.bookings, auditTrail, clock);
  const shared = { ...repositories, audit: auditTrail, ids, clock, bookingLock, revocation };

  return {
    crewLeads: new CrewLeadService(repositories.users, auditTrail, ids, clock),
    passengers: new PassengerService(shared),
    resources: new ResourceService(shared),
    bookings: new BookingService({ ...shared, policy }),
    audit: new AuditService(repositories.auditLog),
    repositories,
    clock,
  };
}
