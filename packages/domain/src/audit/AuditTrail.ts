import type { Clock, IdGenerator } from '../shared/ports';
import type {
  AuditAction,
  AuditActorRef,
  AuditDetailValue,
  AuditEvent,
  AuditOutcome,
  AuditSubjectType,
} from './AuditEvent';
import type { AuditLog } from './AuditLog';

export interface AuditRecordInput {
  actor: AuditActorRef;
  action: AuditAction;
  outcome?: AuditOutcome;
  subject: { type: AuditSubjectType; id: string | null };
  details?: Record<string, AuditDetailValue>;
}

/** Builds well-formed, immutable audit events and appends them to the log. */
export class AuditTrail {
  constructor(
    private readonly log: AuditLog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async record(input: AuditRecordInput): Promise<AuditEvent> {
    const event: AuditEvent = Object.freeze({
      id: this.ids.next(),
      occurredAt: this.clock.now(),
      actor: Object.freeze({ userId: input.actor.userId, role: input.actor.role }),
      action: input.action,
      outcome: input.outcome ?? 'SUCCESS',
      subject: Object.freeze({ ...input.subject }),
      details: Object.freeze({ ...(input.details ?? {}) }),
    });
    await this.log.append(event);
    return event;
  }
}
