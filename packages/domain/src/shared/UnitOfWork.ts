import type { AuditLog } from '../audit/AuditLog';
import type { BookingRepository } from '../bookings/BookingRepository';
import type { ResourceRepository } from '../resources/ResourceRepository';
import type { UserRepository } from '../users/UserRepository';

/**
 * Storage as read outside any unit of work: listings, reports and sign-in. A `save` or
 * `append` here commits on its own, as a unit of work of one write.
 */
export interface PrmsRepositories {
  users: UserRepository;
  resources: ResourceRepository;
  bookings: BookingRepository;
  auditLog: AuditLog;
}

/** Whose bookings a unit of work is about to read in order to decide something. */
export type ScheduleLock = { resourceId: string } | { passengerId: string };

/**
 * Storage as one unit of work sees it. Reads return the state from before the unit of
 * work; its own writes become visible together, when it commits, or not at all.
 */
export interface Transaction {
  users: UserRepository;
  resources: ResourceRepository;
  bookings: BookingRepository;
  auditLog: Pick<AuditLog, 'append'>;
  /**
   * Serialises this unit of work with every other one that locks the same schedule.
   * Reading a resource's (or passenger's) bookings cannot stop a concurrent unit of work
   * from adding one, so a decision based on those bookings must lock the schedule first.
   */
  lockSchedule(target: ScheduleLock): Promise<void>;
}

/**
 * Runs a use case atomically, isolated from concurrent ones in this process or any
 * other. Implementations may run `work` again after a conflict, so it must have no side
 * effects outside the transaction (no external calls, no logging of outcomes).
 */
export interface UnitOfWork {
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

/** Extra writes a caller needs committed in the same unit of work as a use case. */
export type TransactionHook<T> = (tx: Transaction, result: T) => Promise<void>;

/** Everything the domain needs from storage. */
export interface PrmsStorage {
  readonly repositories: PrmsRepositories;
  readonly unitOfWork: UnitOfWork;
}
