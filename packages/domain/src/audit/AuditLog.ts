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
