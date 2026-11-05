import { SYSTEM_ACTOR } from '../audit/AuditEvent';
import type { AuditTrail } from '../audit/AuditTrail';
import type { Actor } from '../identity/Actor';
import { assertCrewLead } from '../identity/authorization';
import { AsyncMutex } from '../shared/AsyncMutex';
import { ConflictError, CrewRosterError, DomainError } from '../shared/errors';
import type { Clock, IdGenerator } from '../shared/ports';
import { CrewLead, normalizeUsername } from './User';
import type { UserRepository } from './UserRepository';

/** System integrity is maintained by exactly this many Crew Leads. */
export const REQUIRED_CREW_LEAD_COUNT = 3;

export interface RegisterCrewLeadInput {
  username: string;
  displayName: string;
}

/**
 * Owns the Crew Lead roster. Registration is a system (bootstrap) operation —
 * there is intentionally no API that lets anyone add administrators at runtime.
 */
export class CrewLeadService {
  private readonly mutex = new AsyncMutex();

  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditTrail,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  register(input: RegisterCrewLeadInput): Promise<CrewLead> {
    return this.mutex.runExclusive(async () => {
      try {
        const existing = await this.users.findCrewLeads();
        if (existing.length >= REQUIRED_CREW_LEAD_COUNT) {
          throw new ConflictError(
            'CREW_LEAD_LIMIT_REACHED',
            `The ship already has its ${REQUIRED_CREW_LEAD_COUNT} Crew Leads.`,
          );
        }
        const username = normalizeUsername(input.username);
        if (await this.users.findByUsername(username)) {
          throw new ConflictError('USERNAME_TAKEN', `Username '${username}' is already taken.`);
        }
        const lead = CrewLead.create({
          id: this.ids.next(),
          username,
          displayName: input.displayName,
          createdAt: this.clock.now(),
        });
        await this.users.save(lead);
        await this.audit.record({
          actor: SYSTEM_ACTOR,
          action: 'CREW_LEAD_REGISTER',
          subject: { type: 'CREW_LEAD', id: lead.id },
          details: { username: lead.username },
        });
        return lead;
      } catch (error) {
        if (error instanceof DomainError) {
          await this.audit.record({
            actor: SYSTEM_ACTOR,
            action: 'CREW_LEAD_REGISTER',
            outcome: 'DENIED',
            subject: { type: 'CREW_LEAD', id: null },
            details: { username: String(input.username), reason: error.code },
          });
        }
        throw error;
      }
    });
  }

  /** Fails fast at start-up if the roster does not have exactly the required size. */
  async assertRosterComplete(): Promise<void> {
    const count = (await this.users.findCrewLeads()).length;
    if (count !== REQUIRED_CREW_LEAD_COUNT) {
      throw new CrewRosterError(
        `Exactly ${REQUIRED_CREW_LEAD_COUNT} Crew Leads are required, but ${count} are registered.`,
      );
    }
  }

  async list(actor: Actor): Promise<CrewLead[]> {
    assertCrewLead(actor);
    return this.users.findCrewLeads();
  }
}
