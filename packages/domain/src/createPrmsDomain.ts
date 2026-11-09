import { AuditService } from './audit/AuditService';
import { AuditTrail } from './audit/AuditTrail';
import { DEFAULT_BOOKING_POLICY, type BookingPolicy } from './bookings/BookingPolicy';
import { BookingRevocation } from './bookings/BookingRevocation';
import { BookingService } from './bookings/BookingService';
import { ReportService } from './reporting/ReportService';
import { ResourceService } from './resources/ResourceService';
import { systemClock, uuidGenerator, type Clock, type IdGenerator } from './shared/ports';
import type { PrmsStorage } from './shared/UnitOfWork';
import { CrewLeadService } from './users/CrewLeadService';
import { PassengerService } from './users/PassengerService';

export interface PrmsDomainOptions {
  storage: PrmsStorage;
  clock?: Clock;
  ids?: IdGenerator;
  bookingPolicy?: Partial<BookingPolicy>;
}

/**
 * The domain's use cases. Storage is deliberately not exposed: every change goes through
 * a service, so its rules, its unit of work and its audit record always apply.
 */
export interface PrmsDomain {
  crewLeads: CrewLeadService;
  passengers: PassengerService;
  resources: ResourceService;
  bookings: BookingService;
  audit: AuditService;
  reports: ReportService;
  clock: Clock;
  /** The booking rules in force (defaults plus any overrides). */
  bookingPolicy: Readonly<BookingPolicy>;
}

/** Composition root for the domain: wires services to their collaborators. */
export function createPrmsDomain(options: PrmsDomainOptions): PrmsDomain {
  const { repositories, unitOfWork } = options.storage;
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? uuidGenerator;
  const policy: Readonly<BookingPolicy> = Object.freeze({
    ...DEFAULT_BOOKING_POLICY,
    ...options.bookingPolicy,
  });

  // Every change runs in a unit of work of the storage, which also isolates it from
  // changes made by other processes; the audit trail writes inside the same unit.
  const auditTrail = new AuditTrail(unitOfWork, clock, ids);
  const revocation = new BookingRevocation(auditTrail, clock);
  const shared = { ...repositories, audit: auditTrail, ids, clock, revocation };

  return {
    crewLeads: new CrewLeadService(repositories.users, auditTrail, ids, clock),
    passengers: new PassengerService(shared),
    resources: new ResourceService(shared),
    bookings: new BookingService({ ...shared, policy }),
    audit: new AuditService(repositories.auditLog),
    reports: new ReportService({ ...repositories, clock }),
    clock,
    bookingPolicy: policy,
  };
}
