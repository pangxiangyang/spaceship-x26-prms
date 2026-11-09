import {
  ConflictError,
  Role,
  type Actor,
  type MembershipTier,
  type Passenger,
  type Resource,
  type ResourceSpec,
} from '@prms/domain';
import type { AppContainer } from './container';
import type { OffsetClock } from './OffsetClock';

export const DEMO_PASSENGER_PASSWORD = 'passenger123';

const RESOURCES: ResourceSpec[] = [
  {
    name: 'Food Supply Station',
    category: 'FOOD_STATION',
    minTier: 'SILVER',
    capacity: 12,
    description: 'Hot meals and ration packs, deck 2.',
  },
  {
    name: 'Sleeping Pod Bay',
    category: 'SLEEPING_POD',
    minTier: 'SILVER',
    capacity: 20,
    description: 'Climate-controlled rest pods.',
  },
  {
    name: 'Basic Hygiene Pod',
    category: 'HYGIENE',
    minTier: 'SILVER',
    capacity: 6,
    description: 'Water-recycling shower units.',
  },
  {
    name: 'Oxygen Refill Unit',
    category: 'OXYGEN',
    minTier: 'SILVER',
    capacity: 8,
    description: 'Personal O2 canister refills.',
  },
  {
    name: 'Medical Bay',
    category: 'MEDICAL',
    minTier: 'SILVER',
    capacity: 3,
    description: 'General check-ups and first aid.',
  },
  {
    name: 'Fitness Center',
    category: 'FITNESS',
    minTier: 'SILVER',
    capacity: 10,
    description: 'Resistance training against muscle loss.',
  },
  {
    name: 'Private Cabin',
    category: 'CABIN',
    minTier: 'GOLD',
    capacity: 4,
    description: 'Quiet private quarters with a viewport.',
  },
  {
    name: 'Advanced Medical Bay',
    category: 'MEDICAL',
    minTier: 'GOLD',
    capacity: 2,
    description: 'Diagnostics and specialist care.',
  },
  {
    name: 'Luxury O2 Pod',
    category: 'OXYGEN',
    minTier: 'PLATINUM',
    capacity: 2,
    description: 'Enriched-oxygen relaxation pods.',
  },
  {
    name: 'VIP Rec Deck',
    category: 'RECREATION',
    minTier: 'PLATINUM',
    capacity: 6,
    description: 'Observation lounge and holo-games.',
  },
];

const PASSENGERS: { username: string; displayName: string; tier: MembershipTier }[] = [
  { username: 'sam.silver', displayName: 'Sam Okafor', tier: 'SILVER' },
  { username: 'mia.silver', displayName: 'Mia Chen', tier: 'SILVER' },
  { username: 'gwen.gold', displayName: 'Gwen Alvarez', tier: 'GOLD' },
  { username: 'omar.gold', displayName: 'Omar Haddad', tier: 'GOLD' },
  { username: 'pia.platinum', displayName: 'Pia Lindqvist', tier: 'PLATINUM' },
  { username: 'raj.platinum', displayName: 'Raj Patel', tier: 'PLATINUM' },
  { username: 'lena.platinum', displayName: 'Lena Novak', tier: 'PLATINUM' },
  { username: 'theo.platinum', displayName: 'Theo Brandt', tier: 'PLATINUM' },
];

const HOUR_MS = 60 * 60 * 1000;

/**
 * Populates a believable week of activity through the real domain services,
 * so the data obeys every business rule and appears in the audit trail.
 */
export async function seedDemoData(container: AppContainer, clock: OffsetClock): Promise<void> {
  const { domain, auth, persistence } = container;
  const [lead] = await persistence.repositories.users.findCrewLeads();
  if (!lead) throw new Error('Crew Leads must be registered before seeding.');
  const crew: Actor = { userId: lead.id, role: Role.CREW_LEAD };

  const resources = new Map<string, Resource>();
  for (const spec of RESOURCES) {
    resources.set(spec.name, await domain.resources.provision(crew, spec));
  }
  const passengers = new Map<string, Passenger>();
  for (const p of PASSENGERS) {
    passengers.set(
      p.username,
      await auth.createPassengerAccount(crew, { ...p, password: DEMO_PASSENGER_PASSWORD }),
    );
  }

  const today = startOfUtcHour(clock.now());
  const actorFor = (username: string): Actor => ({
    userId: passengers.get(username)!.id,
    role: Role.PASSENGER,
  });

  /** Books (and optionally uses) a slot `daysAgo` days back at `hour`:00 UTC. */
  const pastSession = async (
    username: string,
    resourceName: string,
    daysAgo: number,
    hour: number,
    hours: number,
    used = true,
  ) => {
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo, hour),
    );
    const end = new Date(start.getTime() + hours * HOUR_MS);
    const actor = actorFor(username);
    const resourceId = resources.get(resourceName)!.id;
    const { booking } = await clock.travelTo(new Date(start.getTime() - 2 * HOUR_MS), () =>
      domain.bookings.book(actor, { resourceId, start, end }),
    );
    if (used) {
      await clock.travelTo(start, () => domain.bookings.checkIn(actor, booking.id));
    }
    return booking;
  };

  /**
   * Tries to book a slot an hour before it starts, after the regulars have booked it, so the
   * request is refused for capacity (and audited) whatever time of day the seed runs.
   */
  const turnedAway = async (
    username: string,
    resourceName: string,
    daysAgo: number,
    hour: number,
    hours: number,
  ) => {
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo, hour),
    );
    const end = new Date(start.getTime() + hours * HOUR_MS);
    const resourceId = resources.get(resourceName)!.id;
    await clock
      .travelTo(new Date(start.getTime() - HOUR_MS), () =>
        domain.bookings.book(actorFor(username), { resourceId, start, end }),
      )
      .then(() => {
        throw new Error(`The demo expects ${resourceName} to be full at ${start.toISOString()}.`);
      }, ignoreTurnAway);
  };

  for (let daysAgo = 6; daysAgo >= 1; daysAgo -= 1) {
    await pastSession('sam.silver', 'Food Supply Station', daysAgo, 7, 1);
    await pastSession('sam.silver', 'Fitness Center', daysAgo, 17, 1, daysAgo % 3 !== 0);
    await pastSession('mia.silver', 'Sleeping Pod Bay', daysAgo, 1, 4);
    await pastSession('gwen.gold', 'Private Cabin', daysAgo, 20, 3);
    await pastSession('omar.gold', 'Advanced Medical Bay', daysAgo, 10, 1, daysAgo % 2 === 0);
    // The Luxury O2 Pods are the ship's contested resource: two seats, four regulars.
    await pastSession('pia.platinum', 'Luxury O2 Pod', daysAgo, 14, 2);
    await pastSession('raj.platinum', 'Luxury O2 Pod', daysAgo, 14, 2);
    await turnedAway('lena.platinum', 'Luxury O2 Pod', daysAgo, 14, 2);
    if (daysAgo % 2 === 1) await turnedAway('theo.platinum', 'Luxury O2 Pod', daysAgo, 14, 2);
    await pastSession('lena.platinum', 'VIP Rec Deck', daysAgo, 19, 2);
  }

  // Upcoming bookings so the passenger views are not empty.
  const upcoming = async (
    username: string,
    resourceName: string,
    hoursFromNow: number,
    hours: number,
  ) => {
    const start = new Date(today.getTime() + hoursFromNow * HOUR_MS);
    await domain.bookings.book(actorFor(username), {
      resourceId: resources.get(resourceName)!.id,
      start,
      end: new Date(start.getTime() + hours * HOUR_MS),
    });
  };
  await upcoming('sam.silver', 'Food Supply Station', 2, 1);
  await upcoming('sam.silver', 'Fitness Center', 26, 1);
  await upcoming('gwen.gold', 'Private Cabin', 4, 2);
  await upcoming('pia.platinum', 'Luxury O2 Pod', 3, 2);
  await upcoming('raj.platinum', 'Luxury O2 Pod', 3, 2);
}

/** The seed expects some bookings to be refused for capacity; anything else is a real failure. */
function ignoreTurnAway(error: unknown): void {
  if (error instanceof ConflictError && error.code === 'CAPACITY_EXCEEDED') return;
  throw error;
}

function startOfUtcHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

export interface DemoAccount {
  label: string;
  username: string;
  password: string;
}

/** Sign-in details shown on the login page of a demo deployment. */
export function demoAccounts(crewLead: { username: string; password: string }): DemoAccount[] {
  return [
    { label: 'Crew Lead', username: crewLead.username, password: crewLead.password },
    { label: 'Silver passenger', username: 'sam.silver', password: DEMO_PASSENGER_PASSWORD },
    { label: 'Gold passenger', username: 'gwen.gold', password: DEMO_PASSENGER_PASSWORD },
    { label: 'Platinum passenger', username: 'pia.platinum', password: DEMO_PASSENGER_PASSWORD },
  ];
}
