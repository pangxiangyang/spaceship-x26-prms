import { describe, expect, it } from 'vitest';
import {
  assertCrewLead,
  assertPassenger,
  assertSelfOrCrewLead,
} from '../../src/identity/authorization';
import { Role, type Actor } from '../../src/identity/Actor';
import { ForbiddenError } from '../../src/shared/errors';

const crewLead: Actor = { userId: 'crew-1', role: Role.CREW_LEAD };
const passenger: Actor = { userId: 'pax-1', role: Role.PASSENGER };

describe('authorization guards', () => {
  it('allows crew leads through the crew lead guard', () => {
    expect(() => assertCrewLead(crewLead)).not.toThrow();
  });

  it('rejects passengers from crew lead only actions', () => {
    expect(() => assertCrewLead(passenger)).toThrow(ForbiddenError);
  });

  it('allows passengers through the passenger guard and rejects crew leads', () => {
    expect(() => assertPassenger(passenger)).not.toThrow();
    expect(() => assertPassenger(crewLead)).toThrow(ForbiddenError);
  });

  it('lets passengers act on their own records only', () => {
    expect(() => assertSelfOrCrewLead(passenger, 'pax-1')).not.toThrow();
    expect(() => assertSelfOrCrewLead(passenger, 'pax-2')).toThrow(ForbiddenError);
  });

  it('lets crew leads act on any passenger record', () => {
    expect(() => assertSelfOrCrewLead(crewLead, 'pax-2')).not.toThrow();
  });
});
