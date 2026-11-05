import { NotFoundError } from '../shared/errors';
import { Passenger } from './User';
import type { UserRepository } from './UserRepository';

export async function findPassengerOrThrow(
  users: UserRepository,
  passengerId: string,
): Promise<Passenger> {
  const user = await users.findById(passengerId);
  if (!(user instanceof Passenger)) {
    throw new NotFoundError('Passenger', passengerId);
  }
  return user;
}
