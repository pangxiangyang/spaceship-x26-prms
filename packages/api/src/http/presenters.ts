import {
  Passenger,
  type AnyUser,
  type AuditEvent,
  type Booking,
  type HistoryEntry,
  type Resource,
} from '@prms/domain';

/** JSON shapes returned by the API. Entities never leak directly. */

export const presentUser = (user: AnyUser) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  role: user.role,
  tier: user instanceof Passenger ? user.tier : null,
  createdAt: user.createdAt.toISOString(),
});

export const presentResource = (resource: Resource) => ({
  id: resource.id,
  name: resource.name,
  description: resource.description,
  category: resource.category,
  minTier: resource.minTier,
  capacity: resource.capacity,
  status: resource.status,
  createdAt: resource.createdAt.toISOString(),
  decommissionedAt: resource.decommissionedAt?.toISOString() ?? null,
});

export const presentBooking = (
  booking: Booking,
  now: Date,
  resource?: Pick<Resource, 'name' | 'category'>,
) => ({
  id: booking.id,
  passengerId: booking.passengerId,
  passengerTier: booking.passengerTier,
  resourceId: booking.resourceId,
  resourceName: resource?.name ?? null,
  category: resource?.category ?? null,
  start: booking.slot.start.toISOString(),
  end: booking.slot.end.toISOString(),
  durationMinutes: booking.slot.durationMinutes,
  status: booking.status,
  lifecycle: booking.lifecycle(now),
  checkedInAt: booking.checkedInAt?.toISOString() ?? null,
  cancelledAt: booking.cancelledAt?.toISOString() ?? null,
  cancellationReason: booking.cancellationReason ?? null,
  createdAt: booking.createdAt.toISOString(),
});

export const presentHistoryEntry = (entry: HistoryEntry, now: Date) =>
  presentBooking(entry.booking, now, { name: entry.resourceName, category: entry.category });

export const presentAuditEvent = (
  event: AuditEvent,
  displayNames: ReadonlyMap<string, string>,
) => ({
  id: event.id,
  occurredAt: event.occurredAt.toISOString(),
  actor: {
    ...event.actor,
    displayName:
      event.actor.role === 'SYSTEM' ? 'System' : (displayNames.get(event.actor.userId) ?? null),
  },
  action: event.action,
  outcome: event.outcome,
  subject: event.subject,
  details: event.details,
});
