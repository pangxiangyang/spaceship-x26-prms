// DTOs mirrored from the API's presenters.
export type Tier = 'SILVER' | 'GOLD' | 'PLATINUM';
export type Role = 'CREW_LEAD' | 'PASSENGER';
export type Category =
  | 'SLEEPING_POD'
  | 'FOOD_STATION'
  | 'OXYGEN'
  | 'MEDICAL'
  | 'HYGIENE'
  | 'FITNESS'
  | 'CABIN'
  | 'RECREATION';
export type Lifecycle = 'UPCOMING' | 'IN_PROGRESS' | 'COMPLETED' | 'MISSED' | 'CANCELLED';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  tier: Tier | null;
  createdAt: string;
}

export interface Resource {
  id: string;
  name: string;
  description: string;
  category: Category;
  minTier: Tier;
  capacity: number;
  status: 'ACTIVE' | 'DECOMMISSIONED';
  createdAt: string;
  decommissionedAt: string | null;
}

export interface Booking {
  id: string;
  passengerId: string;
  passengerTier: Tier;
  resourceId: string;
  resourceName: string | null;
  category: Category | null;
  start: string;
  end: string;
  durationMinutes: number;
  status: 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED';
  lifecycle: Lifecycle;
  checkedInAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
}

export interface HistorySummary {
  totalBookings: number;
  upcoming: number;
  inProgress: number;
  completed: number;
  missed: number;
  cancelled: number;
  minutesUsed: number;
  minutesByCategory: Partial<Record<Category, number>>;
  dailyUsage: { date: string; minutes: number }[];
}

export interface Occupancy {
  resourceId: string;
  capacity: number;
  occupied: { start: string; end: string }[];
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actor: { userId: string; role: Role | 'SYSTEM'; displayName: string | null };
  action: string;
  outcome: 'SUCCESS' | 'DENIED';
  subject: { type: string; id: string | null };
  details: Record<string, string | number | boolean | null>;
}

export interface TierUsage {
  tier: Tier;
  passengerCount: number;
  bookings: number;
  sessionsUsed: number;
  minutesBooked: number;
  minutesUsed: number;
  topCategory: Category | null;
}

export interface ResourceDemand {
  resourceId: string;
  resourceName: string;
  category: Category;
  minTier: Tier;
  capacity: number;
  bookings: number;
  minutesBooked: number;
  /** Average use over the period (0..1). */
  utilization: number;
  /** How full it was at its busiest moment (0..1). */
  peakUtilization: number;
  /** Bookings refused because the resource was full. */
  capacityDenials: number;
  /** Different passengers among those refusals. */
  turnedAwayPassengers: number;
  demandLevel: 'HIGH' | 'MODERATE' | 'LOW';
  /** Which rule set the level; null when LOW. */
  demandReason: 'TURNED_AWAY' | 'UTILIZATION' | null;
}

/** When a resource counts as high or moderate demand. */
export interface DemandThresholds {
  /** Average use (0..1). */
  high: number;
  /** Average use (0..1). */
  moderate: number;
  /** Different passengers refused for capacity. */
  minTurnedAwayPassengers: number;
}

export interface Meta {
  tiers: Tier[];
  categories: Category[];
  bookingPolicy: {
    minDurationMinutes: number;
    maxDurationMinutes: number;
    maxAdvanceDays: number;
    checkInLeadMinutes: number;
    maxActiveBookingsPerPassenger: number;
  };
  /** Present only on demo deployments. */
  demo: { accounts: { label: string; username: string; password: string }[] } | null;
}
