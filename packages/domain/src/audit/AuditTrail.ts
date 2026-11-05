import { DomainError } from '../shared/errors';
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

type Details = Record<string, AuditDetailValue>;

export interface AuditRecordInput {
  actor: AuditActorRef;
  action: AuditAction;
  outcome?: AuditOutcome;
  subject: { type: AuditSubjectType; id: string | null };
  details?: Details;
}

export type TrackedOperation = Omit<AuditRecordInput, 'outcome'>;

/** What a successful operation wants to add to its audit event. */
export interface AuditOutcomeDetails {
  subjectId?: string;
  details?: Details;
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

  /**
   * Runs `operation` and records exactly one audit event for it: SUCCESS with the
   * details the operation describes, or DENIED with the business-rule code that
   * stopped it. Services use this so auditing never clutters business logic and
   * no interaction can bypass the trail.
   */
  async track<T>(
    operation: TrackedOperation,
    run: () => Promise<T>,
    describe: (result: T) => AuditOutcomeDetails = () => ({}),
  ): Promise<T> {
    let result: T;
    try {
      result = await run();
    } catch (error) {
      if (error instanceof DomainError) {
        await this.record({
          ...operation,
          outcome: 'DENIED',
          details: { ...operation.details, reason: error.code, message: error.message },
        });
      }
      throw error;
    }
    const outcome = describe(result);
    await this.record({
      ...operation,
      outcome: 'SUCCESS',
      subject: { type: operation.subject.type, id: outcome.subjectId ?? operation.subject.id },
      details: { ...operation.details, ...outcome.details },
    });
    return result;
  }
}
