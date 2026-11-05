import type { Role } from '../identity/Actor';

export const AuditAction = {
  CREW_LEAD_REGISTER: 'CREW_LEAD_REGISTER',
  PASSENGER_CREATE: 'PASSENGER_CREATE',
  PASSENGER_UPDATE: 'PASSENGER_UPDATE',
  TIER_CHANGE: 'TIER_CHANGE',
  RESOURCE_PROVISION: 'RESOURCE_PROVISION',
  RESOURCE_UPDATE: 'RESOURCE_UPDATE',
  RESOURCE_DECOMMISSION: 'RESOURCE_DECOMMISSION',
  BOOKING_CREATE: 'BOOKING_CREATE',
  BOOKING_CANCEL: 'BOOKING_CANCEL',
  USAGE_START: 'USAGE_START',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export type AuditOutcome = 'SUCCESS' | 'DENIED';

export type AuditSubjectType = 'CREW_LEAD' | 'PASSENGER' | 'RESOURCE' | 'BOOKING';

export interface AuditActorRef {
  readonly userId: string;
  readonly role: Role | 'SYSTEM';
}

export const SYSTEM_ACTOR: AuditActorRef = Object.freeze({ userId: 'system', role: 'SYSTEM' });

export type AuditDetailValue = string | number | boolean | null;

export interface AuditEvent {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actor: AuditActorRef;
  readonly action: AuditAction;
  readonly outcome: AuditOutcome;
  readonly subject: { readonly type: AuditSubjectType; readonly id: string | null };
  readonly details: Readonly<Record<string, AuditDetailValue>>;
}
