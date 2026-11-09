import { Role } from '../identity/Actor';
import { isMembershipTier, tierIncludes, type MembershipTier } from '../membership/MembershipTier';
import { ValidationError } from '../shared/errors';
import { requireNonBlank } from '../shared/validation';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const DISPLAY_NAME_MAX = 80;

export function normalizeUsername(raw: string): string {
  const username = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!USERNAME_PATTERN.test(username)) {
    throw new ValidationError(
      'Username must be 3-32 characters of lowercase letters, digits, ".", "_" or "-", starting with a letter or digit.',
    );
  }
  return username;
}

/** Plain data for storing a user; `restoreUser` rebuilds (and re-validates) the entity. */
export interface UserSnapshot {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  /** Passengers only. */
  tier: MembershipTier | null;
  createdAt: Date;
}

export interface UserProps {
  id: string;
  username: string;
  displayName: string;
  createdAt: Date;
}

/** Shared identity for everyone who can sign in to the PRMS. */
export abstract class User {
  abstract readonly role: Role;
  readonly id: string;
  readonly username: string;
  readonly createdAt: Date;
  private _displayName: string;

  protected constructor(props: UserProps) {
    this.id = props.id;
    this.username = normalizeUsername(props.username);
    this.createdAt = props.createdAt;
    this._displayName = requireNonBlank(props.displayName, 'Display name', DISPLAY_NAME_MAX);
  }

  get displayName(): string {
    return this._displayName;
  }

  rename(displayName: string): void {
    this._displayName = requireNonBlank(displayName, 'Display name', DISPLAY_NAME_MAX);
  }

  toSnapshot(): UserSnapshot {
    return {
      id: this.id,
      username: this.username,
      displayName: this._displayName,
      role: this.role,
      tier: null,
      createdAt: this.createdAt,
    };
  }
}

export class CrewLead extends User {
  readonly role = Role.CREW_LEAD;

  private constructor(props: UserProps) {
    super(props);
  }

  static create(props: UserProps): CrewLead {
    return new CrewLead(props);
  }
}

export interface TierChange {
  readonly from: MembershipTier;
  readonly to: MembershipTier;
  readonly direction: 'UPGRADE' | 'DOWNGRADE';
}

export interface PassengerProps extends UserProps {
  tier: MembershipTier;
}

export class Passenger extends User {
  readonly role = Role.PASSENGER;
  private _tier: MembershipTier;

  private constructor(props: PassengerProps) {
    super(props);
    this._tier = Passenger.requireTier(props.tier);
  }

  static create(props: PassengerProps): Passenger {
    return new Passenger(props);
  }

  get tier(): MembershipTier {
    return this._tier;
  }

  override toSnapshot(): UserSnapshot {
    return { ...super.toSnapshot(), tier: this._tier };
  }

  hasAccessTo(requiredTier: MembershipTier): boolean {
    return tierIncludes(this._tier, requiredTier);
  }

  changeTier(next: MembershipTier): TierChange {
    const to = Passenger.requireTier(next);
    if (to === this._tier) {
      throw new ValidationError(`Passenger is already at the ${to} tier.`);
    }
    const from = this._tier;
    this._tier = to;
    return { from, to, direction: tierIncludes(to, from) ? 'UPGRADE' : 'DOWNGRADE' };
  }

  private static requireTier(tier: MembershipTier): MembershipTier {
    if (!isMembershipTier(tier)) {
      throw new ValidationError(`Unknown membership tier '${String(tier)}'.`);
    }
    return tier;
  }
}

export type AnyUser = CrewLead | Passenger;

/** Rebuilds a stored user through the entity factories, so stored data is re-validated. */
export function restoreUser(snapshot: UserSnapshot): AnyUser {
  const props = {
    id: snapshot.id,
    username: snapshot.username,
    displayName: snapshot.displayName,
    createdAt: snapshot.createdAt,
  };
  if (snapshot.role === Role.CREW_LEAD) return CrewLead.create(props);
  if (snapshot.role === Role.PASSENGER && snapshot.tier !== null) {
    return Passenger.create({ ...props, tier: snapshot.tier });
  }
  throw new ValidationError(`Stored user '${snapshot.id}' has no valid role and tier.`);
}
