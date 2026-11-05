import type { AuditEvent } from '../../audit/AuditEvent';
import type { AuditLog, AuditPage, AuditQuery } from '../../audit/AuditLog';

export class InMemoryAuditLog implements AuditLog {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(Object.isFrozen(event) ? event : Object.freeze({ ...event }));
  }

  async query(query: AuditQuery): Promise<AuditPage> {
    const matching = this.events
      .filter(
        (e) =>
          (!query.action || e.action === query.action) &&
          (!query.outcome || e.outcome === query.outcome) &&
          (!query.actorId || e.actor.userId === query.actorId) &&
          (!query.subjectId || e.subject.id === query.subjectId) &&
          (!query.from || e.occurredAt >= query.from) &&
          (!query.to || e.occurredAt <= query.to),
      )
      .reverse();
    const offset = query.offset ?? 0;
    const limit = query.limit ?? matching.length;
    return { items: matching.slice(offset, offset + limit), total: matching.length };
  }
}
