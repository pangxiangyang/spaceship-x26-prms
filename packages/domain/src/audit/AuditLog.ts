import { ValidationError } from '../shared/errors';
import type { AuditAction, AuditEvent, AuditOutcome } from './AuditEvent';

export interface AuditQuery {
  action?: AuditAction;
  outcome?: AuditOutcome;
  actorId?: string;
  subjectId?: string;
  /** The business rule that refused an attempt (the DENIED event's code). */
  reason?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  /** Continues after this position: a previous page's `nextCursor`. */
  after?: string;
}

export interface AuditPage {
  items: AuditEvent[];
  /** All events matching the filters, across every page. */
  total: number;
  /** Pass as `after` for the next (older) page; null on the last page. */
  nextCursor: string | null;
}

/** Append-only persistence port. There is deliberately no update or delete. */
export interface AuditLog {
  append(event: AuditEvent): Promise<void>;
  /** Matching events, newest first (ties broken by id, descending). */
  query(query: AuditQuery): Promise<AuditPage>;
}

/** Whether an event satisfies every filter in a query (ignores paging). Shared by adapters. */
export function matchesAuditQuery(event: AuditEvent, query: AuditQuery): boolean {
  return (
    (!query.action || event.action === query.action) &&
    (!query.outcome || event.outcome === query.outcome) &&
    (!query.actorId || event.actor.userId === query.actorId) &&
    (!query.subjectId || event.subject.id === query.subjectId) &&
    (!query.reason || event.details.reason === query.reason) &&
    (!query.from || event.occurredAt >= query.from) &&
    (!query.to || event.occurredAt <= query.to)
  );
}

/** The order every audit page uses: newest first, then by id, so positions are stable. */
export function newestFirst(a: AuditEvent, b: AuditEvent): number {
  return (
    b.occurredAt.getTime() - a.occurredAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

/** A position in that order. Clients treat it as opaque. */
export interface AuditCursor {
  occurredAt: Date;
  id: string;
}

export function encodeAuditCursor(event: AuditEvent): string {
  return `${event.occurredAt.getTime()}.${event.id}`;
}

const CURSOR_PATTERN = /^(\d{1,16})\.([\w-]{1,128})$/;

export function decodeAuditCursor(cursor: string): AuditCursor {
  const match = CURSOR_PATTERN.exec(cursor);
  if (!match) throw new ValidationError('The audit page cursor is not valid.');
  return { occurredAt: new Date(Number(match[1])), id: match[2]! };
}

/** Whether `event` comes after `cursor` in newest-first order. */
export function isAfterCursor(event: AuditEvent, cursor: AuditCursor): boolean {
  const at = event.occurredAt.getTime();
  const cursorAt = cursor.occurredAt.getTime();
  return at < cursorAt || (at === cursorAt && event.id < cursor.id);
}

/** Pages events already filtered and sorted newest first. Shared by adapters. */
export function paginate(sorted: AuditEvent[], query: AuditQuery): AuditPage {
  const cursor = query.after ? decodeAuditCursor(query.after) : undefined;
  const remaining = cursor ? sorted.filter((e) => isAfterCursor(e, cursor)) : sorted;
  const limit = query.limit ?? remaining.length;
  const items = remaining.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    total: sorted.length,
    nextCursor: last && remaining.length > limit ? encodeAuditCursor(last) : null,
  };
}
