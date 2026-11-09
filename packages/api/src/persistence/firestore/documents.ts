import { Timestamp, type DocumentData } from '@google-cloud/firestore';
import {
  Booking,
  CrewLead,
  Passenger,
  Resource,
  Role,
  type AnyUser,
  type AuditEvent,
} from '@prms/domain';

/**
 * Mapping between domain objects and Firestore documents. Documents hold plain
 * data only; entities are rebuilt through their own factories, which re-validate
 * everything, so a malformed document cannot slip into the domain.
 */

function toDate(value: unknown, field: string): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  throw new Error(`Stored field '${field}' is not a timestamp.`);
}

const toOptionalDate = (value: unknown, field: string): Date | null =>
  value === null || value === undefined ? null : toDate(value, field);

export function userToDocument(user: AnyUser): DocumentData {
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    tier: user instanceof Passenger ? user.tier : null,
    createdAt: user.createdAt,
  };
}

export function userFromDocument(id: string, data: DocumentData): AnyUser {
  const props = {
    id,
    username: data.username,
    displayName: data.displayName,
    createdAt: toDate(data.createdAt, 'createdAt'),
  };
  switch (data.role) {
    case Role.CREW_LEAD:
      return CrewLead.create(props);
    case Role.PASSENGER:
      return Passenger.create({ ...props, tier: data.tier });
    default:
      throw new Error(`Stored user '${id}' has unknown role '${String(data.role)}'.`);
  }
}

export function resourceToDocument(resource: Resource): DocumentData {
  const { id, ...fields } = resource.toSnapshot();
  return fields;
}

export function resourceFromDocument(id: string, data: DocumentData): Resource {
  return Resource.restore({
    id,
    name: data.name,
    description: data.description,
    category: data.category,
    minTier: data.minTier,
    capacity: data.capacity,
    status: data.status,
    createdAt: toDate(data.createdAt, 'createdAt'),
    decommissionedAt: toOptionalDate(data.decommissionedAt, 'decommissionedAt'),
  });
}

export function bookingToDocument(booking: Booking): DocumentData {
  const { id, ...fields } = booking.toSnapshot();
  return fields;
}

export function bookingFromDocument(id: string, data: DocumentData): Booking {
  return Booking.restore({
    id,
    passengerId: data.passengerId,
    resourceId: data.resourceId,
    passengerTier: data.passengerTier,
    start: toDate(data.start, 'start'),
    end: toDate(data.end, 'end'),
    createdAt: toDate(data.createdAt, 'createdAt'),
    status: data.status,
    checkedInAt: toOptionalDate(data.checkedInAt, 'checkedInAt'),
    cancelledAt: toOptionalDate(data.cancelledAt, 'cancelledAt'),
    cancellationReason: data.cancellationReason ?? null,
  });
}

export function auditEventToDocument(event: AuditEvent): DocumentData {
  const { id, ...fields } = event;
  const { reason } = event.details;
  return {
    ...fields,
    actor: { ...event.actor },
    subject: { ...event.subject },
    details: { ...event.details },
    // Copied out of `details` so queries can filter on it (`details` is not indexed by key).
    ...(typeof reason === 'string' ? { reason } : {}),
  };
}

export function auditEventFromDocument(id: string, data: DocumentData): AuditEvent {
  return Object.freeze({
    id,
    occurredAt: toDate(data.occurredAt, 'occurredAt'),
    actor: Object.freeze({ userId: data.actor.userId, role: data.actor.role }),
    action: data.action,
    outcome: data.outcome,
    subject: Object.freeze({ type: data.subject.type, id: data.subject.id ?? null }),
    details: Object.freeze({ ...(data.details ?? {}) }),
  });
}
