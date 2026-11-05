import { createInMemoryRepositories } from '../../src/adapters/in-memory';
import { createPrmsDomain } from '../../src/createPrmsDomain';
import { Role, type Actor } from '../../src/identity/Actor';
import type { MembershipTier } from '../../src/membership/MembershipTier';
import type { ResourceSpec } from '../../src/resources/Resource';
import { FixedClock } from './FixedClock';
import { SequentialIds } from './SequentialIds';

/** "Now" for every test unless a test moves the clock. */
export const NOW = '2026-03-01T08:00:00.000Z';

/** A Date `minutes` after NOW. */
export const at = (minutes: number) => new Date(new Date(NOW).getTime() + minutes * 60_000);

export async function createTestContext() {
  const clock = new FixedClock(NOW);
  const repositories = createInMemoryRepositories();
  const domain = createPrmsDomain({ repositories, clock, ids: new SequentialIds('id') });

  const leads = [];
  for (const name of ['alpha', 'bravo', 'charlie']) {
    leads.push(await domain.crewLeads.register({ username: name, displayName: `Lead ${name}` }));
  }
  const crewLead: Actor = { userId: leads[0]!.id, role: Role.CREW_LEAD };

  let passengerCount = 0;
  const addPassenger = async (tier: MembershipTier) => {
    passengerCount += 1;
    const passenger = await domain.passengers.create(crewLead, {
      username: `pax${passengerCount}`,
      displayName: `Passenger ${passengerCount}`,
      tier,
    });
    const actor: Actor = { userId: passenger.id, role: Role.PASSENGER };
    return { passenger, actor };
  };

  const addResource = (overrides: Partial<ResourceSpec> = {}) =>
    domain.resources.provision(crewLead, {
      name: 'Sleeping Pod A',
      category: 'SLEEPING_POD',
      minTier: 'SILVER',
      capacity: 1,
      ...overrides,
    });

  return { domain, repositories, clock, crewLead, addPassenger, addResource };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
