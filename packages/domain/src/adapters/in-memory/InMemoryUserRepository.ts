import { ConflictError } from '../../shared/errors';
import { CrewLead, Passenger, type AnyUser } from '../../users/User';
import type { UserRepository } from '../../users/UserRepository';

export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, AnyUser>();

  async findById(id: string): Promise<AnyUser | undefined> {
    return this.byId.get(id);
  }

  async findByUsername(username: string): Promise<AnyUser | undefined> {
    const needle = username.trim().toLowerCase();
    return [...this.byId.values()].find((u) => u.username === needle);
  }

  async findPassengers(): Promise<Passenger[]> {
    return [...this.byId.values()].filter((u): u is Passenger => u instanceof Passenger);
  }

  async findCrewLeads(): Promise<CrewLead[]> {
    return [...this.byId.values()].filter((u): u is CrewLead => u instanceof CrewLead);
  }

  async save(user: AnyUser): Promise<void> {
    const clash = await this.findByUsername(user.username);
    if (clash && clash.id !== user.id) {
      throw new ConflictError('USERNAME_TAKEN', `Username '${user.username}' is already taken.`);
    }
    this.byId.set(user.id, user);
  }
}
