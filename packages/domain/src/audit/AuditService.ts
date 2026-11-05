import type { Actor } from '../identity/Actor';
import { assertCrewLead } from '../identity/authorization';
import type { AuditLog, AuditPage, AuditQuery } from './AuditLog';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Read access to the audit trail for Crew Leads. */
export class AuditService {
  constructor(private readonly log: AuditLog) {}

  async list(actor: Actor, query: AuditQuery): Promise<AuditPage> {
    assertCrewLead(actor);
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
    return this.log.query({ ...query, limit, offset });
  }
}
