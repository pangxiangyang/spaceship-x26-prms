import {
  ConflictError,
  CrewLead,
  ValidationError,
  type Actor,
  type AnyUser,
  type CreatePassengerInput,
  type Passenger,
  type PrmsDomain,
  type RegisterCrewLeadInput,
  type TransactionHook,
  type UserRepository,
} from '@prms/domain';
import type { Persistence } from '../persistence/Persistence';
import { AuthenticationError } from './AuthenticationError';
import type { CredentialStore } from './CredentialStore';
import type { PasswordHasher } from './PasswordHasher';
import type { TokenService } from './TokenService';

export const PASSWORD_MIN_LENGTH = 8;
/** Looked up for unknown usernames, so they cost the same storage reads as real ones. */
const NO_SUCH_ACCOUNT_ID = 'no-such-account';
export const PASSWORD_MAX_LENGTH = 128;

export interface LoginResult {
  token: string;
  expiresIn: number;
  user: AnyUser;
}

/**
 * Account concerns that sit around the domain: credentials and sessions.
 * The domain decides *who may do what*; this service only establishes *who you are*.
 */
export class AuthService {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly domain: PrmsDomain,
    private readonly users: UserRepository,
    private readonly storage: Pick<Persistence, 'credentials' | 'credentialsIn'>,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  private get credentials(): CredentialStore {
    return this.storage.credentials;
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.users.findByUsername(username);
    // Unknown usernames make the same reads and a comparison against a dummy hash, so
    // response times do not reveal which usernames exist.
    const hash = await this.credentials.getPasswordHash(user?.id ?? NO_SUCH_ACCOUNT_ID);
    const matches = await this.hasher.verify(password, hash ?? (await this.getDummyHash()));
    if (!user || !hash || !matches) {
      throw new AuthenticationError('Invalid username or password.');
    }
    return { ...this.tokens.issue({ userId: user.id, role: user.role }), user };
  }

  async currentUser(actor: Actor): Promise<AnyUser> {
    const user = await this.users.findById(actor.userId);
    if (!user || user.role !== actor.role) {
      throw new AuthenticationError('Your account no longer exists.');
    }
    return user;
  }

  async registerCrewLead(input: RegisterCrewLeadInput & { password: string }): Promise<CrewLead> {
    assertPasswordPolicy(input.password);
    // Hash first: the unit of work may run more than once and should stay short.
    const hash = await this.hasher.hash(input.password);
    return this.domain.crewLeads.register(input, this.storePassword(hash));
  }

  /**
   * Makes a configured Crew Lead exist with the configured password. Safe to run
   * on every start against persistent storage: an existing lead is kept (and its
   * password updated if the configuration rotated it), a missing one is
   * registered through the domain, which still enforces the limit of three.
   */
  async ensureCrewLead(input: RegisterCrewLeadInput & { password: string }): Promise<CrewLead> {
    const existing = await this.users.findByUsername(input.username);
    if (!existing) return this.registerCrewLead(input);
    if (!(existing instanceof CrewLead)) {
      throw new ConflictError(
        'USERNAME_TAKEN',
        `Configured Crew Lead '${existing.username}' is already a passenger account.`,
      );
    }
    const hash = await this.credentials.getPasswordHash(existing.id);
    if (!hash || !(await this.hasher.verify(input.password, hash))) {
      assertPasswordPolicy(input.password);
      await this.credentials.setPasswordHash(existing.id, await this.hasher.hash(input.password));
    }
    return existing;
  }

  async createPassengerAccount(
    actor: Actor,
    input: CreatePassengerInput & { password: string },
  ): Promise<Passenger> {
    assertPasswordPolicy(input.password);
    const hash = await this.hasher.hash(input.password);
    return this.domain.passengers.create(actor, input, this.storePassword(hash));
  }

  /** Stores the password with the new account, in its unit of work: both exist, or neither. */
  private storePassword(hash: string): TransactionHook<AnyUser> {
    return (tx, account) => this.storage.credentialsIn(tx).setPasswordHash(account.id, hash);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('not-a-real-password');
    return this.dummyHash;
  }
}

function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new ValidationError(
      `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
}
