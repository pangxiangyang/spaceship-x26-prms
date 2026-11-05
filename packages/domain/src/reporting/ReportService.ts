import type { AuditLog } from '../audit/AuditLog';
import type { Booking, BookingLifecycle } from '../bookings/Booking';
import type { BookingRepository } from '../bookings/BookingRepository';
import { TimeSlot } from '../bookings/TimeSlot';
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

export interface ResourceDemand {
  resourceId: string;
  resourceName: string;
  category: ResourceCategory;
  minTier: MembershipTier;
  capacity: number;
  bookings: number;
  minutesBooked: number;
  /** Booked seat-minutes divided by available seat-minutes in the period (0..1). */
  utilization: number;
  /** Booking requests refused because the resource was full. */
  capacityDenials: number;
  demandLevel: DemandLevel;
}

export interface DemandThresholds {
  high: number;
  moderate: number;
}

export const DEFAULT_DEMAND_THRESHOLDS: Readonly<DemandThresholds> = Object.freeze({
  high: 0.75,
  moderate: 0.4,
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
        const utilization = minutesBooked / (resource.capacity * period.durationMinutes);
        const capacityDenials = denials.get(resource.id) ?? 0;
        return {
          resourceId: resource.id,
          resourceName: resource.name,
          category: resource.category,
          minTier: resource.minTier,
          capacity: resource.capacity,
          bookings: own.length,
          minutesBooked,
          utilization: round(utilization, 4),
          capacityDenials,
          demandLevel: demandLevel(utilization, capacityDenials, thresholds),
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
    return (await this.deps.bookings.findAll()).filter(
      (b) => b.occupiesCapacity && b.slot.overlaps(period),
    );
  }

  /** Counts CAPACITY_EXCEEDED denials whose requested slot overlaps the period. */
  private async capacityDenialsIn(period: TimeSlot): Promise<Map<string, number>> {
    const { items } = await this.deps.auditLog.query({
      action: 'BOOKING_CREATE',
      outcome: 'DENIED',
    });
    const counts = new Map<string, number>();
    for (const event of items) {
      const { reason, start, end } = event.details;
      if (reason !== 'CAPACITY_EXCEEDED' || !event.subject.id) continue;
      if (typeof start !== 'string' || typeof end !== 'string') continue;
      const requested = TimeSlot.of(new Date(start), new Date(end));
      if (!requested.overlaps(period)) continue;
      counts.set(event.subject.id, (counts.get(event.subject.id) ?? 0) + 1);
    }
    return counts;
  }
}

function assertReportablePeriod(period: TimeSlot): void {
  if (period.durationMinutes * MINUTE_MS > MAX_REPORT_DAYS * DAY_MS) {
    throw new ValidationError(`Report periods can span at most ${MAX_REPORT_DAYS} days.`);
  }
}

function clippedMinutes(booking: Booking, period: TimeSlot): number {
  return booking.slot.clampTo(period)?.durationMinutes ?? 0;
}

function demandLevel(utilization: number, denials: number, t: DemandThresholds): DemandLevel {
  if (denials > 0 || utilization >= t.high) return 'HIGH';
  if (utilization >= t.moderate) return 'MODERATE';
  return 'LOW';
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
