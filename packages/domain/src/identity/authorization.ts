import { ForbiddenError } from '../shared/errors';
import { Role, type Actor } from './Actor';

export function assertCrewLead(actor: Actor): void {
  if (actor.role !== Role.CREW_LEAD) {
    throw new ForbiddenError('Only Crew Leads can perform this action.');
  }
}

export function assertPassenger(actor: Actor): void {
  if (actor.role !== Role.PASSENGER) {
    throw new ForbiddenError('Only passengers can perform this action.');
  }
}

export function assertSelfOrCrewLead(actor: Actor, passengerId: string): void {
  if (actor.role === Role.CREW_LEAD) return;
  if (actor.userId !== passengerId) {
    throw new ForbiddenError('You can only access your own passenger records.');
  }
}
