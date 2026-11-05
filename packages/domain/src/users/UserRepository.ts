import type { AnyUser, CrewLead, Passenger } from './User';

/**
 * Persistence port for users. Implementations must enforce username uniqueness
 * (the equivalent of a unique index) as a last line of defence.
 */
export interface UserRepository {
  findById(id: string): Promise<AnyUser | undefined>;
  findByUsername(username: string): Promise<AnyUser | undefined>;
  findPassengers(): Promise<Passenger[]>;
  findCrewLeads(): Promise<CrewLead[]>;
  save(user: AnyUser): Promise<void>;
}
