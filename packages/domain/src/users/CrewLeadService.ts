import { SYSTEM_ACTOR } from '../audit/AuditEvent';
import type { AuditTrail } from '../audit/AuditTrail';
import type { Actor } from '../identity/Actor';
import { assertCrewLead } from '../identity/authorization';
import { ConflictError, CrewRosterError } from '../shared/errors';
import type { Clock, IdGenerator } from '../shared/ports';
import type { TransactionHook } from '../shared/UnitOfWork';
import { REQUIRED_CREW_LEAD_COUNT } from './crewRoster';
import { CrewLead, normalizeUsername } from './User';
import type { UserRepository } from './UserRepository';

export { REQUIRED_CREW_LEAD_COUNT };

export interface RegisterCrewLeadInput {
  username: string;
  displayName: string;
}

/**
 * Owns the Crew Lead roster. Registration is a system (bootstrap) operation —
 * there is intentionally no API that lets anyone add administrators at runtime.
 * Storage enforces the limit of three as well, as a last line of defence.
 */
export class CrewLeadService {
  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditTrail,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** `attach` stores something with the new account (its credentials) in the same unit of work. */
  register(input: RegisterCrewLeadInput, attach?: TransactionHook<CrewLead>): Promise<CrewLead> {
    return this.audit.track(
      {
        actor: SYSTEM_ACTOR,
        action: 'CREW_LEAD_REGISTER',
        subject: { type: 'CREW_LEAD', id: null },
        details: { username: String(input.username) },
      },
      async (tx) => {
        const existing = await tx.users.findCrewLeads();
        if (existing.length >= REQUIRED_CREW_LEAD_COUNT) {
          throw new ConflictError(
            'CREW_LEAD_LIMIT_REACHED',
            `The ship already has its ${REQUIRED_CREW_LEAD_COUNT} Crew Leads.`,
          );
        }
        const username = normalizeUsername(input.username);
        if (await tx.users.findByUsername(username)) {
          throw new ConflictError('USERNAME_TAKEN', `Username '${username}' is already taken.`);
        }
        const lead = CrewLead.create({
          id: this.ids.next(),
          username,
          displayName: input.displayName,
          createdAt: this.clock.now(),
        });
        await tx.users.save(lead);
        await attach?.(tx, lead);
        return lead;
      },
      (lead) => ({ subjectId: lead.id, details: { username: lead.username } }),
    );
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
