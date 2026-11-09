import type { CollectionReference, Firestore, Query } from '@google-cloud/firestore';
import {
  ConflictError,
  Role,
  matchesAuditQuery,
  paginate,
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

/*
 * Every query below filters on at most one field, so Firestore serves it from
 * the single-field indexes it creates automatically: no index configuration
 * has to be deployed alongside the code.
 */

export class FirestoreUserRepository implements UserRepository {
  constructor(
    private readonly db: Firestore,
    private readonly users: CollectionReference,
  ) {}

  async findById(id: string): Promise<AnyUser | undefined> {
    const snapshot = await this.users.doc(id).get();
    return snapshot.exists ? userFromDocument(snapshot.id, snapshot.data()!) : undefined;
  }

  async findByUsername(username: string): Promise<AnyUser | undefined> {
    const needle = username.trim().toLowerCase();
    const snapshot = await this.users.where('username', '==', needle).limit(1).get();
    const doc = snapshot.docs[0];
    return doc ? userFromDocument(doc.id, doc.data()) : undefined;
  }

  async findPassengers(): Promise<Passenger[]> {
    return (await this.byRole(Role.PASSENGER)) as Passenger[];
  }

  async findCrewLeads(): Promise<CrewLead[]> {
    return (await this.byRole(Role.CREW_LEAD)) as CrewLead[];
  }

  /** Checks username uniqueness and writes in one transaction, so two writers cannot both win. */
  async save(user: AnyUser): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const sameName = await tx.get(this.users.where('username', '==', user.username).limit(2));
      if (sameName.docs.some((doc) => doc.id !== user.id)) {
        throw new ConflictError('USERNAME_TAKEN', `Username '${user.username}' is already taken.`);
      }
      tx.set(this.users.doc(user.id), userToDocument(user));
    });
  }

  private async byRole(role: Role): Promise<AnyUser[]> {
    const snapshot = await this.users.where('role', '==', role).get();
    return snapshot.docs.map((doc) => userFromDocument(doc.id, doc.data()));
  }
}

export class FirestoreResourceRepository implements ResourceRepository {
  constructor(private readonly resources: CollectionReference) {}

  async findById(id: string): Promise<Resource | undefined> {
    const snapshot = await this.resources.doc(id).get();
    return snapshot.exists ? resourceFromDocument(snapshot.id, snapshot.data()!) : undefined;
  }

  async findAll(): Promise<Resource[]> {
    const snapshot = await this.resources.get();
    return snapshot.docs.map((doc) => resourceFromDocument(doc.id, doc.data()));
  }

  async save(resource: Resource): Promise<void> {
    await this.resources.doc(resource.id).set(resourceToDocument(resource));
  }
}

export class FirestoreBookingRepository implements BookingRepository {
  constructor(private readonly bookings: CollectionReference) {}

  async findById(id: string): Promise<Booking | undefined> {
    const snapshot = await this.bookings.doc(id).get();
    return snapshot.exists ? bookingFromDocument(snapshot.id, snapshot.data()!) : undefined;
  }

  findByPassenger(passengerId: string): Promise<Booking[]> {
    return this.list(this.bookings.where('passengerId', '==', passengerId));
  }

  findByResource(resourceId: string): Promise<Booking[]> {
    return this.list(this.bookings.where('resourceId', '==', resourceId));
  }

  findAll(): Promise<Booking[]> {
    return this.list(this.bookings);
  }

  async save(booking: Booking): Promise<void> {
    await this.bookings.doc(booking.id).set(bookingToDocument(booking));
  }

  private async list(query: Query): Promise<Booking[]> {
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => bookingFromDocument(doc.id, doc.data()));
  }
}

export class FirestoreAuditLog implements AuditLog {
  constructor(private readonly events: CollectionReference) {}

  /** `create` fails if the id exists, so an event can never be overwritten. */
  async append(event: AuditEvent): Promise<void> {
    await this.events.doc(event.id).create(auditEventToDocument(event));
  }

  /**
   * Pushes the most selective equality filter down to Firestore and applies the
   * rest in memory, with exactly the in-memory semantics. Fine at the scale of
   * one ship; a larger deployment would add composite indexes for the filter
   * combinations the UI uses and page with cursors.
   */
  async query(query: AuditQuery): Promise<AuditPage> {
    const snapshot = await this.narrowestQuery(query).get();
    const newestFirst = snapshot.docs
      .map((doc) => auditEventFromDocument(doc.id, doc.data()))
      .filter((event) => matchesAuditQuery(event, query))
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id));
    return paginate(newestFirst, query);
  }

  private narrowestQuery(query: AuditQuery): Query {
    if (query.subjectId) return this.events.where('subject.id', '==', query.subjectId);
    if (query.actorId) return this.events.where('actor.userId', '==', query.actorId);
    if (query.action) return this.events.where('action', '==', query.action);
    if (query.outcome) return this.events.where('outcome', '==', query.outcome);
    return this.events;
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
