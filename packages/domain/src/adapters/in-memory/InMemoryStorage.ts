import type { AuditEvent } from '../../audit/AuditEvent';
import {
  matchesAuditQuery,
  paginate,
  type AuditLog,
  type AuditPage,
  type AuditQuery,
} from '../../audit/AuditLog';
import { Booking, type BookingSnapshot } from '../../bookings/Booking';
import type { BookingRepository } from '../../bookings/BookingRepository';
import { Role } from '../../identity/Actor';
import { Resource, type ResourceSnapshot } from '../../resources/Resource';
import type { ResourceRepository } from '../../resources/ResourceRepository';
import { AsyncMutex } from '../../shared/AsyncMutex';
import { ConflictError } from '../../shared/errors';
import type {
  PrmsRepositories,
  PrmsStorage,
  Transaction,
  UnitOfWork,
} from '../../shared/UnitOfWork';
import { REQUIRED_CREW_LEAD_COUNT } from '../../users/crewRoster';
import {
  restoreUser,
  type AnyUser,
  type CrewLead,
  type Passenger,
  type UserSnapshot,
} from '../../users/User';
import type { UserRepository } from '../../users/UserRepository';

/** Committed rows. Entities are stored as snapshots and handed out as fresh copies. */
interface Tables {
  users: Map<string, UserSnapshot>;
  resources: Map<string, ResourceSnapshot>;
  bookings: Map<string, BookingSnapshot>;
  auditEvents: AuditEvent[];
}

/** The writes of one unit of work, applied together on commit. */
interface Changes {
  users: Map<string, UserSnapshot>;
  resources: Map<string, ResourceSnapshot>;
  bookings: Map<string, BookingSnapshot>;
  auditEvents: AuditEvent[];
}

const emptyTables = (): Tables => ({
  users: new Map(),
  resources: new Map(),
  bookings: new Map(),
  auditEvents: [],
});

/**
 * Process-local storage with the same guarantees as a database: units of work are
 * serialised by one lock owned by the store (so every domain instance sharing it is
 * serialised too), their writes are buffered and applied only if they succeed, and the
 * store enforces username uniqueness and the Crew Lead limit itself.
 */
export class InMemoryStorage implements PrmsStorage {
  private tables = emptyTables();
  private readonly lock = new AsyncMutex();
  readonly repositories: PrmsRepositories;
  readonly unitOfWork: UnitOfWork;

  constructor() {
    const committed = () => this.tables;
    this.unitOfWork = { run: (work) => this.lock.runExclusive(() => this.runIsolated(work)) };
    const autoCommit = this.unitOfWork;
    this.repositories = {
      users: new MemoryUsers(committed, autoCommit),
      resources: new MemoryResources(committed, autoCommit),
      bookings: new MemoryBookings(committed, autoCommit),
      auditLog: new MemoryAuditLog(committed, autoCommit),
    };
  }

  /** Removes everything. Used by the demo reset. */
  clear(): void {
    this.tables = emptyTables();
  }

  private async runIsolated<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const committed = () => this.tables;
    const changes: Changes = {
      users: new Map(),
      resources: new Map(),
      bookings: new Map(),
      auditEvents: [],
    };
    const tx: Transaction = {
      users: new MemoryUsers(committed, changes),
      resources: new MemoryResources(committed, changes),
      bookings: new MemoryBookings(committed, changes),
      auditLog: new MemoryAuditLog(committed, changes),
      // Every unit of work already holds the store's lock, so schedules are serialised.
      lockSchedule: async () => {},
    };
    const result = await work(tx);
    this.commit(changes);
    return result;
  }

  private commit(changes: Changes): void {
    for (const [id, row] of changes.users) this.tables.users.set(id, row);
    for (const [id, row] of changes.resources) this.tables.resources.set(id, row);
    for (const [id, row] of changes.bookings) this.tables.bookings.set(id, row);
    this.tables.auditEvents.push(...changes.auditEvents);
  }
}

export function createInMemoryStorage(): InMemoryStorage {
  return new InMemoryStorage();
}

/**
 * Inside a unit of work, writes go to its `Changes`. Outside one, a write runs as a unit
 * of work of its own, so it takes the store's lock and passes the same checks.
 */
type WriteTarget = Changes | UnitOfWork;
const isChanges = (target: WriteTarget): target is Changes => !('run' in target);

class MemoryUsers implements UserRepository {
  constructor(
    private readonly tables: () => Tables,
    private readonly writes: WriteTarget,
  ) {}

  async findById(id: string): Promise<AnyUser | undefined> {
    const row = this.tables().users.get(id);
    return row && restoreUser(row);
  }

  async findByUsername(username: string): Promise<AnyUser | undefined> {
    const needle = username.trim().toLowerCase();
    const row = [...this.tables().users.values()].find((u) => u.username === needle);
    return row && restoreUser(row);
  }

  async findPassengers(): Promise<Passenger[]> {
    return this.byRole(Role.PASSENGER) as Passenger[];
  }

  async findCrewLeads(): Promise<CrewLead[]> {
    return this.byRole(Role.CREW_LEAD) as CrewLead[];
  }

  async save(user: AnyUser): Promise<void> {
    const changes = this.writes;
    if (!isChanges(changes)) return changes.run((tx) => tx.users.save(user));

    const rows = new Map([...this.tables().users, ...changes.users]);
    const clash = [...rows.values()].find((u) => u.username === user.username && u.id !== user.id);
    if (clash) {
      throw new ConflictError('USERNAME_TAKEN', `Username '${user.username}' is already taken.`);
    }
    const isNewLead = user.role === Role.CREW_LEAD && rows.get(user.id)?.role !== Role.CREW_LEAD;
    const leads = [...rows.values()].filter((u) => u.role === Role.CREW_LEAD).length;
    if (isNewLead && leads >= REQUIRED_CREW_LEAD_COUNT) {
      throw new ConflictError(
        'CREW_LEAD_LIMIT_REACHED',
        `The ship already has its ${REQUIRED_CREW_LEAD_COUNT} Crew Leads.`,
      );
    }
    changes.users.set(user.id, user.toSnapshot());
  }

  private byRole(role: Role): AnyUser[] {
    return [...this.tables().users.values()].filter((u) => u.role === role).map(restoreUser);
  }
}

class MemoryResources implements ResourceRepository {
  constructor(
    private readonly tables: () => Tables,
    private readonly writes: WriteTarget,
  ) {}

  async findById(id: string): Promise<Resource | undefined> {
    const row = this.tables().resources.get(id);
    return row && Resource.restore(row);
  }

  async findAll(): Promise<Resource[]> {
    return [...this.tables().resources.values()].map((row) => Resource.restore(row));
  }

  async save(resource: Resource): Promise<void> {
    const changes = this.writes;
    if (!isChanges(changes)) return changes.run((tx) => tx.resources.save(resource));
    changes.resources.set(resource.id, resource.toSnapshot());
  }
}

class MemoryBookings implements BookingRepository {
  constructor(
    private readonly tables: () => Tables,
    private readonly writes: WriteTarget,
  ) {}

  async findById(id: string): Promise<Booking | undefined> {
    const row = this.tables().bookings.get(id);
    return row && Booking.restore(row);
  }

  async findByPassenger(passengerId: string): Promise<Booking[]> {
    return this.where((b) => b.passengerId === passengerId);
  }

  async findByResource(resourceId: string): Promise<Booking[]> {
    return this.where((b) => b.resourceId === resourceId);
  }

  async findAll(): Promise<Booking[]> {
    return this.where(() => true);
  }

  async save(booking: Booking): Promise<void> {
    const changes = this.writes;
    if (!isChanges(changes)) return changes.run((tx) => tx.bookings.save(booking));
    changes.bookings.set(booking.id, booking.toSnapshot());
  }

  private where(predicate: (row: BookingSnapshot) => boolean): Booking[] {
    return [...this.tables().bookings.values()]
      .filter(predicate)
      .map((row) => Booking.restore(row));
  }
}

class MemoryAuditLog implements AuditLog {
  constructor(
    private readonly tables: () => Tables,
    private readonly writes: WriteTarget,
  ) {}

  /** Events are immutable: an id can be written once. */
  async append(event: AuditEvent): Promise<void> {
    const changes = this.writes;
    if (!isChanges(changes)) return changes.run((tx) => tx.auditLog.append(event));
    const exists = (e: AuditEvent) => e.id === event.id;
    if (this.tables().auditEvents.some(exists) || changes.auditEvents.some(exists)) {
      throw new Error(`Audit event '${event.id}' already exists.`);
    }
    changes.auditEvents.push(Object.isFrozen(event) ? event : Object.freeze({ ...event }));
  }

  async query(query: AuditQuery): Promise<AuditPage> {
    const newestFirst = this.tables()
      .auditEvents.filter((e) => matchesAuditQuery(e, query))
      .reverse();
    return paginate(newestFirst, query);
  }
}
