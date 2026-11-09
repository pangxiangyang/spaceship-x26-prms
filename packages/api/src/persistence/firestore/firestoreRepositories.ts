import type {
  CollectionReference,
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  QuerySnapshot,
  Transaction as FirestoreTransaction,
} from '@google-cloud/firestore';
import {
  ConflictError,
  REQUIRED_CREW_LEAD_COUNT,
  Role,
  decodeAuditCursor,
  encodeAuditCursor,
  type AnyUser,
  type AuditEvent,
  type AuditLog,
  type AuditPage,
  type AuditQuery,
  type Booking,
  type BookingRepository,
  type CrewLead,
  type Passenger,
  type Resource,
  type ResourceRepository,
  type ScheduleLock,
  type TimeSlot,
  type Transaction,
  type UnitOfWork,
  type UserRepository,
} from '@prms/domain';
import type { CredentialStore } from '../../auth/CredentialStore';
import {
  auditEventFromDocument,
  auditEventToDocument,
  bookingFromDocument,
  bookingToDocument,
  resourceFromDocument,
  resourceToDocument,
  userFromDocument,
  userToDocument,
} from './documents';

/** The collections of one environment. */
export interface FirestoreCollections {
  users: CollectionReference;
  resources: CollectionReference;
  bookings: CollectionReference;
  auditEvents: CollectionReference;
  credentials: CollectionReference;
  system: CollectionReference;
  /** One document per username: makes usernames unique even for concurrent writers. */
  usernames: CollectionReference;
  /** One document per resource or passenger schedule, written to serialise bookings. */
  scheduleLocks: CollectionReference;
}

/** Firestore's name for ordering by document id (`FieldPath.documentId()`). */
const DOCUMENT_ID = '__name__';

/** Runs a transaction again after a conflict, up to this many attempts in all. */
const MAX_TRANSACTION_ATTEMPTS = 10;

/** Reads either directly or inside a Firestore transaction. */
interface Reader {
  doc(ref: DocumentReference): Promise<DocumentSnapshot>;
  query(query: Query): Promise<QuerySnapshot>;
}

const directReader: Reader = { doc: (ref) => ref.get(), query: (query) => query.get() };

/**
 * Units of work as Firestore transactions. Firestore requires every read before the
 * first write and may run the callback again on contention, so writes are buffered and
 * applied at the end; reads see the data as it was before the transaction.
 */
export class FirestoreUnitOfWork implements UnitOfWork {
  constructor(
    private readonly db: Firestore,
    private readonly collections: FirestoreCollections,
  ) {}

  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(
      async (transaction) => {
        const tx = new FirestoreTransactionContext(transaction, this.collections);
        const result = await work(tx);
        tx.applyWrites();
        return result;
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  }
}

/** One attempt of a unit of work. */
export class FirestoreTransactionContext implements Transaction {
  readonly users: UserRepository;
  readonly resources: ResourceRepository;
  readonly bookings: BookingRepository;
  readonly auditLog: Pick<AuditLog, 'append'>;
  /** Password hashes in this transaction (for the API; the domain never sees them). */
  readonly credentials: CredentialStore;

  private readonly writes = new Map<string, () => void>();
  private readonly locked = new Set<string>();
  private crewRoster: Promise<string[]> | undefined;

  constructor(
    private readonly transaction: FirestoreTransaction,
    private readonly c: FirestoreCollections,
  ) {
    const reader: Reader = {
      doc: (ref) => transaction.get(ref),
      query: (query) => transaction.get(query),
    };
    this.users = new FirestoreUsers(c, reader, (user) => this.stageUser(reader, user));
    this.resources = new FirestoreResources(c, reader, async (resource) =>
      this.stage(c.resources.doc(resource.id), resourceToDocument(resource)),
    );
    this.bookings = new FirestoreBookings(c, reader, async (booking) =>
      this.stage(c.bookings.doc(booking.id), bookingToDocument(booking)),
    );
    this.auditLog = {
      // `create` fails if the id exists, so an event can never be overwritten.
      append: async (event) => {
        const ref = c.auditEvents.doc(event.id);
        this.writes.set(ref.path, () => transaction.create(ref, auditEventToDocument(event)));
      },
    };
    this.credentials = {
      setPasswordHash: async (userId, hash) =>
        this.stage(c.credentials.doc(userId), { passwordHash: hash }),
      getPasswordHash: async (userId) =>
        (await transaction.get(c.credentials.doc(userId))).get('passwordHash') ?? undefined,
    };
  }

  /**
   * Reads and rewrites the schedule's lock document. Two transactions that lock the same
   * schedule then conflict, and Firestore makes one of them wait or retry.
   */
  async lockSchedule(target: ScheduleLock): Promise<void> {
    const key =
      'resourceId' in target ? `resource_${target.resourceId}` : `passenger_${target.passengerId}`;
    if (this.locked.has(key)) return;
    this.locked.add(key);
    const ref = this.c.scheduleLocks.doc(key);
    const current = await this.transaction.get(ref);
    this.stage(ref, { version: ((current.get('version') as number | undefined) ?? 0) + 1 });
  }

  applyWrites(): void {
    for (const write of this.writes.values()) write();
  }

  private stage(ref: DocumentReference, data: DocumentData): void {
    this.writes.set(ref.path, () => this.transaction.set(ref, data));
  }

  /** Enforces unique usernames and the Crew Lead limit in storage, for any writer. */
  private async stageUser(reader: Reader, user: AnyUser): Promise<void> {
    const claimRef = this.c.usernames.doc(user.username);
    const claim = await reader.doc(claimRef);
    if (claim.exists && claim.get('userId') !== user.id) {
      throw new ConflictError('USERNAME_TAKEN', `Username '${user.username}' is already taken.`);
    }
    if (user.role === Role.CREW_LEAD) {
      const rosterRef = this.c.system.doc('crewRoster');
      this.crewRoster ??= reader
        .doc(rosterRef)
        .then((doc) => [...((doc.get('crewLeadIds') as string[] | undefined) ?? [])]);
      const roster = await this.crewRoster;
      if (!roster.includes(user.id)) {
        if (roster.length >= REQUIRED_CREW_LEAD_COUNT) {
          throw new ConflictError(
            'CREW_LEAD_LIMIT_REACHED',
            `The ship already has its ${REQUIRED_CREW_LEAD_COUNT} Crew Leads.`,
          );
        }
        roster.push(user.id);
        this.stage(rosterRef, { crewLeadIds: [...roster] });
      }
    }
    this.stage(claimRef, { userId: user.id });
    this.stage(this.c.users.doc(user.id), userToDocument(user));
  }
}

/*
 * The repositories below read through a `Reader` (directly, or inside a transaction)
 * and hand writes to `persist`: inside a transaction that stages them; outside one it
 * runs a unit of work of one write, so the same checks apply to every writer.
 */

export class FirestoreUsers implements UserRepository {
  constructor(
    private readonly c: FirestoreCollections,
    private readonly read: Reader,
    private readonly persist: (user: AnyUser) => Promise<void>,
  ) {}

  async findById(id: string): Promise<AnyUser | undefined> {
    const snapshot = await this.read.doc(this.c.users.doc(id));
    return snapshot.exists ? userFromDocument(snapshot.id, snapshot.data()!) : undefined;
  }

  async findByUsername(username: string): Promise<AnyUser | undefined> {
    const needle = username.trim().toLowerCase();
    const snapshot = await this.read.query(this.c.users.where('username', '==', needle).limit(1));
    const doc = snapshot.docs[0];
    return doc ? userFromDocument(doc.id, doc.data()) : undefined;
  }

  async findPassengers(): Promise<Passenger[]> {
    return (await this.byRole(Role.PASSENGER)) as Passenger[];
  }

  async findCrewLeads(): Promise<CrewLead[]> {
    return (await this.byRole(Role.CREW_LEAD)) as CrewLead[];
  }

  save(user: AnyUser): Promise<void> {
    return this.persist(user);
  }

  private async byRole(role: Role): Promise<AnyUser[]> {
    const snapshot = await this.read.query(this.c.users.where('role', '==', role));
    return snapshot.docs.map((doc) => userFromDocument(doc.id, doc.data()));
  }
}

export class FirestoreResources implements ResourceRepository {
  constructor(
    private readonly c: FirestoreCollections,
    private readonly read: Reader,
    private readonly persist: (resource: Resource) => Promise<void>,
  ) {}

  async findById(id: string): Promise<Resource | undefined> {
    const snapshot = await this.read.doc(this.c.resources.doc(id));
    return snapshot.exists ? resourceFromDocument(snapshot.id, snapshot.data()!) : undefined;
  }

  async findAll(): Promise<Resource[]> {
    const snapshot = await this.read.query(this.c.resources);
    return snapshot.docs.map((doc) => resourceFromDocument(doc.id, doc.data()));
  }

  save(resource: Resource): Promise<void> {
    return this.persist(resource);
  }
}

export class FirestoreBookings implements BookingRepository {
  constructor(
    private readonly c: FirestoreCollections,
    private readonly read: Reader,
    private readonly persist: (booking: Booking) => Promise<void>,
  ) {}

  async findById(id: string): Promise<Booking | undefined> {
    const snapshot = await this.read.doc(this.c.bookings.doc(id));
    return snapshot.exists ? bookingFromDocument(snapshot.id, snapshot.data()!) : undefined;
  }

  findByPassenger(passengerId: string, window?: TimeSlot): Promise<Booking[]> {
    const own = this.c.bookings.where('passengerId', '==', passengerId);
    return window ? this.overlapping(own, window) : this.list(own);
  }

  findByResource(resourceId: string, window: TimeSlot): Promise<Booking[]> {
    return this.overlapping(this.c.bookings.where('resourceId', '==', resourceId), window);
  }

  findOverlapping(window: TimeSlot): Promise<Booking[]> {
    return this.overlapping(this.c.bookings, window);
  }

  findAll(): Promise<Booking[]> {
    return this.list(this.c.bookings);
  }

  save(booking: Booking): Promise<void> {
    return this.persist(booking);
  }

  /**
   * Firestore allows a range filter on one field, so the query asks for bookings that end
   * after the window starts (served by the `(…, end)` composite indexes) and the start is
   * checked here. A booking lasts at most a few hours, so few extra documents are read.
   */
  private async overlapping(query: Query, window: TimeSlot): Promise<Booking[]> {
    const endingAfterStart = await this.list(query.where('end', '>', window.start));
    return endingAfterStart.filter((b) => b.slot.start < window.end);
  }

  private async list(query: Query): Promise<Booking[]> {
    const snapshot = await this.read.query(query);
    return snapshot.docs.map((doc) => bookingFromDocument(doc.id, doc.data()));
  }
}

export class FirestoreAuditLog implements AuditLog {
  constructor(
    private readonly events: CollectionReference,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  append(event: AuditEvent): Promise<void> {
    return this.unitOfWork.run((tx) => tx.auditLog.append(event));
  }

  /**
   * Firestore filters, orders and pages: a page costs about `limit` reads plus one count
   * aggregation, however long the trail grows. Each filter has a composite index with
   * `occurredAt` (deploy/firestore.indexes.json), and Firestore merges them when a query
   * combines filters. A query without a limit (reports) reads exactly what matches.
   */
  async query(query: AuditQuery): Promise<AuditPage> {
    const filtered = this.filtered(query);
    let page = filtered.orderBy('occurredAt', 'desc').orderBy(DOCUMENT_ID, 'desc');
    if (query.after) {
      const cursor = decodeAuditCursor(query.after);
      page = page.startAfter(cursor.occurredAt, cursor.id);
    }
    if (query.limit === undefined) {
      const items = (await page.get()).docs.map((d) => auditEventFromDocument(d.id, d.data()));
      return { items, total: items.length, nextCursor: null };
    }
    const [snapshot, count] = await Promise.all([
      page.limit(query.limit + 1).get(),
      filtered.count().get(),
    ]);
    const events = snapshot.docs.map((d) => auditEventFromDocument(d.id, d.data()));
    const items = events.slice(0, query.limit);
    const last = items[items.length - 1];
    return {
      items,
      total: count.data().count,
      nextCursor: last && events.length > query.limit ? encodeAuditCursor(last) : null,
    };
  }

  private filtered(query: AuditQuery): Query {
    let q: Query = this.events;
    if (query.action) q = q.where('action', '==', query.action);
    if (query.outcome) q = q.where('outcome', '==', query.outcome);
    if (query.actorId) q = q.where('actor.userId', '==', query.actorId);
    if (query.subjectId) q = q.where('subject.id', '==', query.subjectId);
    if (query.reason) q = q.where('reason', '==', query.reason);
    if (query.from) q = q.where('occurredAt', '>=', query.from);
    if (query.to) q = q.where('occurredAt', '<=', query.to);
    return q;
  }
}

export class FirestoreCredentialStore implements CredentialStore {
  constructor(private readonly credentials: CollectionReference) {}

  async setPasswordHash(userId: string, hash: string): Promise<void> {
    await this.credentials.doc(userId).set({ passwordHash: hash });
  }

  async getPasswordHash(userId: string): Promise<string | undefined> {
    const snapshot = await this.credentials.doc(userId).get();
    return snapshot.get('passwordHash') ?? undefined;
  }
}

/** Repositories for reads outside a transaction; their writes each run a unit of work. */
export function directRepositories(c: FirestoreCollections, unitOfWork: UnitOfWork) {
  return {
    users: new FirestoreUsers(c, directReader, (user) =>
      unitOfWork.run((tx) => tx.users.save(user)),
    ),
    resources: new FirestoreResources(c, directReader, (resource) =>
      unitOfWork.run((tx) => tx.resources.save(resource)),
    ),
    bookings: new FirestoreBookings(c, directReader, (booking) =>
      unitOfWork.run((tx) => tx.bookings.save(booking)),
    ),
    auditLog: new FirestoreAuditLog(c.auditEvents, unitOfWork),
  };
}
