import type { AuditLog } from '../audit/AuditLog';
import type { Booking, BookingLifecycle } from '../bookings/Booking';
import type { BookingRepository } from '../bookings/BookingRepository';
import { peakConcurrency, type TimeSlot } from '../bookings/TimeSlot';
import type { Actor } from '../identity/Actor';
import { assertCrewLead, assertSelfOrCrewLead } from '../identity/authorization';
import { ALL_TIERS, type MembershipTier } from '../membership/MembershipTier';
import type { Resource } from '../resources/Resource';
import type { ResourceCategory } from '../resources/ResourceCategory';
import type { ResourceRepository } from '../resources/ResourceRepository';
import { ValidationError } from '../shared/errors';
import type { Clock } from '../shared/ports';
import { findPassengerOrThrow } from '../users/lookups';
import type { Passenger } from '../users/User';
import type { UserRepository } from '../users/UserRepository';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_REPORT_DAYS = 90;
const TREND_DAYS = 7;

export interface HistoryEntry {
  booking: Booking;
  resourceName: string;
  category: ResourceCategory;
  lifecycle: BookingLifecycle;
}

export interface DailyUsage {
  /** UTC calendar date, YYYY-MM-DD. */
  date: string;
  minutes: number;
}

export interface PersonalHistory {
  passenger: Passenger;
  /** Newest first. */
  entries: HistoryEntry[];
  summary: {
    totalBookings: number;
    upcoming: number;
    inProgress: number;
    completed: number;
    missed: number;
    cancelled: number;
    minutesUsed: number;
    minutesByCategory: Partial<Record<ResourceCategory, number>>;
    /** Minutes used per day over the last week, oldest first, ending today. */
    dailyUsage: DailyUsage[];
  };
}

export interface TierUsage {
  tier: MembershipTier;
  /** Passengers currently holding this tier. */
  passengerCount: number;
  /** Non-cancelled bookings made at this tier that overlap the period. */
  bookings: number;
  sessionsUsed: number;
  minutesBooked: number;
  minutesUsed: number;
  topCategory: ResourceCategory | null;
}

export type DemandLevel = 'HIGH' | 'MODERATE' | 'LOW';

/** Which rule set the demand level: refused requests, or average use. Null when LOW. */
export type DemandReason = 'TURNED_AWAY' | 'UTILIZATION' | null;

export interface ResourceDemand {
  resourceId: string;
  resourceName: string;
  category: ResourceCategory;
  minTier: MembershipTier;
  capacity: number;
  bookings: number;
  minutesBooked: number;
  /** Average use: booked seat-minutes divided by available seat-minutes in the period (0..1). */
  utilization: number;
  /**
   * Peak use: the most places in use at any one moment, divided by capacity (0..1). A resource
   * that is full every afternoon and empty at night has a low average but a peak of 1.
   */
  peakUtilization: number;
  /** Booking requests refused because the resource was full. */
  /** Bookings refused because the resource was full. */
  capacityDenials: number;
  /** Different passengers among those refusals. */
  turnedAwayPassengers: number;
  demandLevel: DemandLevel;
  demandReason: DemandReason;
}

export interface DemandThresholds {
  /** Average use from which a resource is in high demand. */
  high: number;
  /** Average use from which a resource is in moderate demand. */
  moderate: number;
  /**
   * How many different passengers must be refused for capacity before that alone means
   * high demand. More than one, so one passenger retrying cannot raise the alarm.
   */
  minTurnedAwayPassengers: number;
}

export const DEFAULT_DEMAND_THRESHOLDS: Readonly<DemandThresholds> = Object.freeze({
  high: 0.75,
  moderate: 0.4,
  minTurnedAwayPassengers: 2,
});

export interface ReportServiceDeps {
  users: UserRepository;
  resources: ResourceRepository;
  bookings: BookingRepository;
  auditLog: AuditLog;
  clock: Clock;
}

const LEVEL_ORDER: Record<DemandLevel, number> = { HIGH: 0, MODERATE: 1, LOW: 2 };

/** Read-only insights for passengers (their own history) and Crew Leads (ship-wide). */
export class ReportService {
  constructor(private readonly deps: ReportServiceDeps) {}

  async personalHistory(actor: Actor, passengerId: string): Promise<PersonalHistory> {
    assertSelfOrCrewLead(actor, passengerId);
    const passenger = await findPassengerOrThrow(this.deps.users, passengerId);
    const resources = await this.resourceIndex();
    const now = this.deps.clock.now();

    const entries = (await this.deps.bookings.findByPassenger(passengerId))
      .sort((a, b) => b.slot.start.getTime() - a.slot.start.getTime())
      .flatMap((booking) => {
        const resource = resources.get(booking.resourceId);
        if (!resource) return [];
        return [
          {
            booking,
            resourceName: resource.name,
            category: resource.category,
            lifecycle: booking.lifecycle(now),
          },
        ];
      });

    const count = (lifecycle: BookingLifecycle) =>
      entries.filter((e) => e.lifecycle === lifecycle).length;
    const minutesByCategory: Partial<Record<ResourceCategory, number>> = {};
    for (const { booking, category } of entries) {
      if (booking.usedMinutes > 0) {
        minutesByCategory[category] = (minutesByCategory[category] ?? 0) + booking.usedMinutes;
      }
    }

    return {
      passenger,
      entries,
      summary: {
        totalBookings: entries.length,
        upcoming: count('UPCOMING'),
        inProgress: count('IN_PROGRESS'),
        completed: count('COMPLETED'),
        missed: count('MISSED'),
        cancelled: count('CANCELLED'),
        minutesUsed: entries.reduce((sum, e) => sum + e.booking.usedMinutes, 0),
        minutesByCategory,
        dailyUsage: dailyUsage(
          entries.map((e) => e.booking),
          now,
        ),
      },
    };
  }

  async usageByTier(actor: Actor, period: TimeSlot): Promise<TierUsage[]> {
    assertCrewLead(actor);
    assertReportablePeriod(period);
    const [passengers, bookings, resources] = await Promise.all([
      this.deps.users.findPassengers(),
      this.bookingsIn(period),
      this.resourceIndex(),
    ]);

    return ALL_TIERS.map((tier) => {
      const atTier = bookings.filter((b) => b.passengerTier === tier);
      const minutesByCategory = new Map<ResourceCategory, number>();
      for (const b of atTier) {
        const category = resources.get(b.resourceId)?.category;
        if (category) {
          minutesByCategory.set(
            category,
            (minutesByCategory.get(category) ?? 0) + clippedMinutes(b, period),
          );
        }
      }
      const top = [...minutesByCategory.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        tier,
        passengerCount: passengers.filter((p) => p.tier === tier).length,
        bookings: atTier.length,
        sessionsUsed: atTier.filter((b) => b.usedMinutes > 0).length,
        minutesBooked: sum(atTier.map((b) => clippedMinutes(b, period))),
        minutesUsed: sum(
          atTier.filter((b) => b.usedMinutes > 0).map((b) => clippedMinutes(b, period)),
        ),
        topCategory: top?.[0] ?? null,
      };
    });
  }

  /**
   * Identifies high-demand resources. A resource is HIGH demand when it is
   * mostly booked or when passengers were turned away because it was full —
   * the latter is the clearest early signal of a shortage.
   */
  async resourceDemand(
    actor: Actor,
    period: TimeSlot,
    thresholds: DemandThresholds = DEFAULT_DEMAND_THRESHOLDS,
  ): Promise<ResourceDemand[]> {
    assertCrewLead(actor);
    assertReportablePeriod(period);
    const [resources, bookings, denials] = await Promise.all([
      this.deps.resources.findAll(),
      this.bookingsIn(period),
      this.capacityDenialsIn(period),
    ]);

    return resources
      .map((resource) => {
        const own = bookings.filter((b) => b.resourceId === resource.id);
        const minutesBooked = sum(own.map((b) => clippedMinutes(b, period)));
        const availableMinutes = resource.capacity * inServiceMinutes(resource, period);
        const utilization = availableMinutes > 0 ? minutesBooked / availableMinutes : 0;
        const peakUtilization =
          peakConcurrency(
            own.map((b) => b.slot),
            period,
          ) / resource.capacity;
        const refused = denials.get(resource.id);
        const capacityDenials = refused?.refusals ?? 0;
        const turnedAwayPassengers = refused?.passengers.size ?? 0;
        const { level, reason } = assessDemand(utilization, turnedAwayPassengers, thresholds);
        return {
          resourceId: resource.id,
          resourceName: resource.name,
          category: resource.category,
          minTier: resource.minTier,
          capacity: resource.capacity,
          bookings: own.length,
          minutesBooked,
          utilization: round(utilization, 4),
          peakUtilization: round(peakUtilization, 4),
          capacityDenials,
          turnedAwayPassengers,
          demandLevel: level,
          demandReason: reason,
          active: resource.isActive,
        };
      })
      .filter((row) => row.active || row.bookings > 0)
      .map(({ active: _active, ...row }) => row)
      .sort(
        (a, b) =>
          LEVEL_ORDER[a.demandLevel] - LEVEL_ORDER[b.demandLevel] ||
          b.utilization - a.utilization ||
          b.capacityDenials - a.capacityDenials ||
          a.resourceName.localeCompare(b.resourceName),
      );
  }

  private async resourceIndex(): Promise<Map<string, Resource>> {
    return new Map((await this.deps.resources.findAll()).map((r) => [r.id, r]));
  }

  private async bookingsIn(period: TimeSlot): Promise<Booking[]> {
    return (await this.deps.bookings.findOverlapping(period)).filter((b) => b.occupiesCapacity);
  }

  /**
   * Bookings refused for capacity during the period, per resource: how many refusals and
   * from which passengers. A refusal counts when it happened, not by the slot that was
   * asked for, so today's refusals for next week are today's shortage signal.
   */
  private async capacityDenialsIn(period: TimeSlot): Promise<Map<string, TurnAways>> {
    const { items } = await this.deps.auditLog.query({
      action: 'BOOKING_CREATE',
      outcome: 'DENIED',
      reason: 'CAPACITY_EXCEEDED',
      from: period.start,
      to: period.end,
    });
    const byResource = new Map<string, TurnAways>();
    for (const event of items) {
      if (!event.subject.id) continue;
      const entry = byResource.get(event.subject.id) ?? { refusals: 0, passengers: new Set() };
      entry.refusals += 1;
      entry.passengers.add(event.actor.userId);
      byResource.set(event.subject.id, entry);
    }
    return byResource;
  }
}

interface TurnAways {
  refusals: number;
  passengers: Set<string>;
}

function assertReportablePeriod(period: TimeSlot): void {
  if (period.durationMinutes * MINUTE_MS > MAX_REPORT_DAYS * DAY_MS) {
    throw new ValidationError(`Report periods can span at most ${MAX_REPORT_DAYS} days.`);
  }
}

/**
 * How long the resource was in service during the period: from provisioning until it was
 * decommissioned. Capacity changes are not stored, so today's capacity applies throughout.
 */
function inServiceMinutes(resource: Resource, period: TimeSlot): number {
  const from = Math.max(period.start.getTime(), resource.createdAt.getTime());
  const to = Math.min(
    period.end.getTime(),
    resource.decommissionedAt?.getTime() ?? Number.POSITIVE_INFINITY,
  );
  return Math.max(0, to - from) / MINUTE_MS;
}

function clippedMinutes(booking: Booking, period: TimeSlot): number {
  return booking.slot.clampTo(period)?.durationMinutes ?? 0;
}

/**
 * Refused requests are the clearest shortage signal, so they outrank average use: a
 * resource that turns several passengers away at its busy hour is in short supply, however
 * idle it is overnight.
 */
function assessDemand(
  utilization: number,
  turnedAwayPassengers: number,
  t: DemandThresholds,
): { level: DemandLevel; reason: DemandReason } {
  if (turnedAwayPassengers >= t.minTurnedAwayPassengers) {
    return { level: 'HIGH', reason: 'TURNED_AWAY' };
  }
  if (utilization >= t.high) return { level: 'HIGH', reason: 'UTILIZATION' };
  if (utilization >= t.moderate) return { level: 'MODERATE', reason: 'UTILIZATION' };
  return { level: 'LOW', reason: null };
}

function dailyUsage(bookings: Booking[], now: Date): DailyUsage[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Array.from({ length: TREND_DAYS }, (_, i) =>
    new Date(today - (TREND_DAYS - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
  const minutes = new Map(days.map((d) => [d, 0]));
  for (const booking of bookings) {
    const day = booking.slot.start.toISOString().slice(0, 10);
    if (minutes.has(day)) minutes.set(day, (minutes.get(day) ?? 0) + booking.usedMinutes);
  }
  return days.map((date) => ({ date, minutes: minutes.get(date) ?? 0 }));
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
const round = (value: number, places: number) => Number(value.toFixed(places));
