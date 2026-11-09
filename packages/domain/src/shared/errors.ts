/**
 * Every business-rule violation is expressed as a DomainError carrying a stable,
 * machine-readable `code`. Delivery layers (HTTP, CLI, …) translate these codes
 * into their own status semantics; the domain never knows about HTTP.
 */
export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'TIER_ACCESS_DENIED'
  | 'CREW_LEAD_LIMIT_REACHED'
  | 'CREW_ROSTER_INCOMPLETE'
  | 'USERNAME_TAKEN'
  | 'CAPACITY_EXCEEDED'
  | 'BOOKING_OVERLAP'
  | 'BOOKING_LIMIT_EXCEEDED'
  | 'RESOURCE_UNAVAILABLE'
  | 'INVALID_STATE';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Input that can never be valid, regardless of system state. */
export class ValidationError extends DomainError {
  constructor(message: string) {
    super('VALIDATION_FAILED', message);
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} '${id}' was not found.`);
  }
}

/** The actor's role does not permit the action. */
export class ForbiddenError extends DomainError {
  constructor(message = 'You are not allowed to perform this action.') {
    super('FORBIDDEN', message);
  }
}

/** The passenger's membership tier does not grant access to a resource. */
export class TierAccessDeniedError extends DomainError {
  constructor(message: string) {
    super('TIER_ACCESS_DENIED', message);
  }
}

export type ConflictCode = Extract<
  DomainErrorCode,
  | 'CREW_LEAD_LIMIT_REACHED'
  | 'USERNAME_TAKEN'
  | 'CAPACITY_EXCEEDED'
  | 'BOOKING_OVERLAP'
  | 'RESOURCE_UNAVAILABLE'
  | 'INVALID_STATE'
  | 'BOOKING_LIMIT_EXCEEDED'
>;

/** The request is well-formed but conflicts with the current system state. */
export class ConflictError extends DomainError {
  constructor(code: ConflictCode, message: string) {
    super(code, message);
  }
}

/** The system was configured in a way that violates a mission invariant. */
export class CrewRosterError extends DomainError {
  constructor(message: string) {
    super('CREW_ROSTER_INCOMPLETE', message);
  }
}
