import {
  ValidationError,
  type Actor,
  type AnyUser,
  type CreatePassengerInput,
  type CrewLead,
  type Passenger,
  type PrmsDomain,
  type RegisterCrewLeadInput,
} from '@prms/domain';
import { AuthenticationError } from './AuthenticationError';
import type { CredentialStore } from './CredentialStore';
import type { PasswordHasher } from './PasswordHasher';
import type { TokenService } from './TokenService';

export const PASSWORD_MIN_LENGTH = 8;
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
    private readonly credentials: CredentialStore,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.domain.repositories.users.findByUsername(username);
    const hash = user ? await this.credentials.getPasswordHash(user.id) : undefined;
    // Compare against a dummy hash for unknown users so timing does not reveal which usernames exist.
    const matches = await this.hasher.verify(password, hash ?? (await this.getDummyHash()));
    if (!user || !hash || !matches) {
      throw new AuthenticationError('Invalid username or password.');
    }
    return { ...this.tokens.issue({ userId: user.id, role: user.role }), user };
  }

  async currentUser(actor: Actor): Promise<AnyUser> {
    const user = await this.domain.repositories.users.findById(actor.userId);
    if (!user || user.role !== actor.role) {
      throw new AuthenticationError('Your account no longer exists.');
    }
    return user;
  }

  async registerCrewLead(input: RegisterCrewLeadInput & { password: string }): Promise<CrewLead> {
    assertPasswordPolicy(input.password);
    const lead = await this.domain.crewLeads.register(input);
    await this.credentials.setPasswordHash(lead.id, await this.hasher.hash(input.password));
    return lead;
  }

  async createPassengerAccount(
    actor: Actor,
    input: CreatePassengerInput & { password: string },
  ): Promise<Passenger> {
    assertPasswordPolicy(input.password);
    const passenger = await this.domain.passengers.create(actor, input);
    await this.credentials.setPasswordHash(passenger.id, await this.hasher.hash(input.password));
    return passenger;
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
