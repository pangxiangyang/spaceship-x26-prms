import type { AuditEvent } from '../../audit/AuditEvent';
import {
  matchesAuditQuery,
  paginate,
  type AuditLog,
  type AuditPage,
  type AuditQuery,
} from '../../audit/AuditLog';

export class InMemoryAuditLog implements AuditLog {
  private readonly events: AuditEvent[] = [];

  /** Removes everything. Used by the demo reset. */
  clear(): void {
    this.events.length = 0;
  }

  async append(event: AuditEvent): Promise<void> {
    this.events.push(Object.isFrozen(event) ? event : Object.freeze({ ...event }));
  }

  async query(query: AuditQuery): Promise<AuditPage> {
    const newestFirst = this.events.filter((e) => matchesAuditQuery(e, query)).reverse();
    return paginate(newestFirst, query);
  }
}
