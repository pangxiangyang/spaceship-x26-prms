import { DomainError } from '../shared/errors';
import type { Clock, IdGenerator } from '../shared/ports';
import type { Transaction, UnitOfWork } from '../shared/UnitOfWork';
import type {
  AuditAction,
  AuditActorRef,
  AuditDetailValue,
  AuditEvent,
  AuditOutcome,
  AuditSubjectType,
} from './AuditEvent';

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

/**
 * Builds well-formed, immutable audit events and writes them: inside the unit of work of
 * the change they describe, or on their own for an attempt that changed nothing.
 */
export class AuditTrail {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** Appends an event as part of `tx`, so it commits (or not) with the change it describes. */
  async append(tx: Transaction, input: AuditRecordInput): Promise<AuditEvent> {
    const event = this.build(input);
    await tx.auditLog.append(event);
    return event;
  }

  /** Records an event on its own, for an attempt that changed nothing. */
  record(input: AuditRecordInput): Promise<AuditEvent> {
    return this.unitOfWork.run((tx) => this.append(tx, input));
  }

  /**
   * Runs `work` in one unit of work and records exactly one audit event for it. On
   * success the SUCCESS event commits in the same unit of work as the change, so a change
   * can never exist without its record. A business-rule refusal changes nothing, so its
   * DENIED event (with the rule's code) is written afterwards on its own. Infrastructure
   * failures are not business events: they go to the structured logs, not the trail.
   */
  async track<T>(
    operation: TrackedOperation,
    work: (tx: Transaction) => Promise<T>,
    describe: (result: T) => AuditOutcomeDetails = () => ({}),
  ): Promise<T> {
    try {
      return await this.unitOfWork.run(async (tx) => {
        const result = await work(tx);
        const outcome = describe(result);
        await this.append(tx, {
          ...operation,
          outcome: 'SUCCESS',
          subject: { type: operation.subject.type, id: outcome.subjectId ?? operation.subject.id },
          details: { ...operation.details, ...outcome.details },
        });
        return result;
      });
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
  }

  private build(input: AuditRecordInput): AuditEvent {
    return Object.freeze({
      id: this.ids.next(),
      occurredAt: this.clock.now(),
      actor: Object.freeze({ userId: input.actor.userId, role: input.actor.role }),
      action: input.action,
      outcome: input.outcome ?? 'SUCCESS',
      subject: Object.freeze({ ...input.subject }),
      details: Object.freeze({ ...(input.details ?? {}) }),
    });
  }
}
