import type { AuditAction, AuditEvent, AuditOutcome } from './AuditEvent';

export interface AuditQuery {
  action?: AuditAction;
  outcome?: AuditOutcome;
  actorId?: string;
  subjectId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditPage {
  items: AuditEvent[];
  total: number;
}

/** Append-only persistence port. There is deliberately no update or delete. */
export interface AuditLog {
  append(event: AuditEvent): Promise<void>;
  /** Matching events, newest first. */
  query(query: AuditQuery): Promise<AuditPage>;
}

/** Whether an event satisfies every filter in a query (ignores paging). Shared by adapters. */
export function matchesAuditQuery(event: AuditEvent, query: AuditQuery): boolean {
  return (
    (!query.action || event.action === query.action) &&
    (!query.outcome || event.outcome === query.outcome) &&
    (!query.actorId || event.actor.userId === query.actorId) &&
    (!query.subjectId || event.subject.id === query.subjectId) &&
    (!query.from || event.occurredAt >= query.from) &&
    (!query.to || event.occurredAt <= query.to)
  );
}

/** Applies a query's offset and limit to events that are already sorted newest first. */
export function paginate(events: AuditEvent[], query: AuditQuery): AuditPage {
  const offset = query.offset ?? 0;
  const limit = query.limit ?? events.length;
  return { items: events.slice(offset, offset + limit), total: events.length };
}
