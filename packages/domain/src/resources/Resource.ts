import { isMembershipTier, tierIncludes, type MembershipTier } from '../membership/MembershipTier';
import { ConflictError, ValidationError } from '../shared/errors';
import { requireIntegerInRange, requireNonBlank } from '../shared/validation';
import { isResourceCategory, type ResourceCategory } from './ResourceCategory';

export const ResourceStatus = {
  ACTIVE: 'ACTIVE',
  DECOMMISSIONED: 'DECOMMISSIONED',
} as const;

export type ResourceStatus = (typeof ResourceStatus)[keyof typeof ResourceStatus];

export const MAX_RESOURCE_CAPACITY = 500;

export interface ResourceSpec {
  name: string;
  description?: string;
  category: ResourceCategory;
  minTier: MembershipTier;
  /** How many passengers may use the resource at the same moment. */
  capacity: number;
}

export type ResourceChanges = Partial<ResourceSpec>;

export interface ResourceProps extends ResourceSpec {
  id: string;
  createdAt: Date;
}

/** Plain-data form of a resource, for persistence adapters. */
export interface ResourceSnapshot {
  id: string;
  name: string;
  description: string;
  category: ResourceCategory;
  minTier: MembershipTier;
  capacity: number;
  status: ResourceStatus;
  createdAt: Date;
  decommissionedAt: Date | null;
}

/** A bookable piece of ship infrastructure (a pod, a station, a bay, …). */
export class Resource {
  readonly id: string;
  readonly createdAt: Date;
  private _name!: string;
  private _description!: string;
  private _category!: ResourceCategory;
  private _minTier!: MembershipTier;
  private _capacity!: number;
  private _status: ResourceStatus = ResourceStatus.ACTIVE;
  private _decommissionedAt: Date | undefined;

  private constructor(props: ResourceProps) {
    this.id = props.id;
    this.createdAt = props.createdAt;
    this.apply(props);
  }

  static provision(props: ResourceProps): Resource {
    return new Resource(props);
  }

  /** Rebuilds a stored resource, re-validating it so corrupt data cannot enter the domain. */
  static restore(snapshot: ResourceSnapshot): Resource {
    const resource = new Resource(snapshot);
    if (snapshot.status === ResourceStatus.DECOMMISSIONED) {
      if (!snapshot.decommissionedAt) {
        throw new ValidationError(`Stored resource '${snapshot.id}' has no decommission date.`);
      }
      resource.decommission(snapshot.decommissionedAt);
    } else if (snapshot.status !== ResourceStatus.ACTIVE) {
      throw new ValidationError(
        `Stored resource '${snapshot.id}' has unknown status '${String(snapshot.status)}'.`,
      );
    }
    return resource;
  }

  toSnapshot(): ResourceSnapshot {
    return {
      id: this.id,
      name: this._name,
      description: this._description,
      category: this._category,
      minTier: this._minTier,
      capacity: this._capacity,
      status: this._status,
      createdAt: this.createdAt,
      decommissionedAt: this._decommissionedAt ?? null,
    };
  }

  get name(): string {
    return this._name;
  }
  get description(): string {
    return this._description;
  }
  get category(): ResourceCategory {
    return this._category;
  }
  get minTier(): MembershipTier {
    return this._minTier;
  }
  get capacity(): number {
    return this._capacity;
  }
  get status(): ResourceStatus {
    return this._status;
  }
  get decommissionedAt(): Date | undefined {
    return this._decommissionedAt;
  }
  get isActive(): boolean {
    return this._status === ResourceStatus.ACTIVE;
  }

  /** Whether a passenger of `tier` is entitled to this resource (ignores status). */
  isAccessibleTo(tier: MembershipTier): boolean {
    return tierIncludes(tier, this._minTier);
  }

  update(changes: ResourceChanges): void {
    this.assertActive();
    this.apply({
      name: changes.name ?? this._name,
      description: changes.description ?? this._description,
      category: changes.category ?? this._category,
      minTier: changes.minTier ?? this._minTier,
      capacity: changes.capacity ?? this._capacity,
    });
  }

  decommission(at: Date): void {
    this.assertActive();
    this._status = ResourceStatus.DECOMMISSIONED;
    this._decommissionedAt = at;
  }

  private assertActive(): void {
    if (!this.isActive) {
      throw new ConflictError('INVALID_STATE', `Resource '${this._name}' has been decommissioned.`);
    }
  }

  /** Validates everything before assigning anything, so a failed update leaves no trace. */
  private apply(spec: ResourceSpec): void {
    const name = requireNonBlank(spec.name, 'Resource name', 80);
    const description = (spec.description ?? '').trim();
    if (description.length > 280) {
      throw new ValidationError('Description must be at most 280 characters.');
    }
    if (!isResourceCategory(spec.category)) {
      throw new ValidationError(`Unknown resource category '${String(spec.category)}'.`);
    }
    if (!isMembershipTier(spec.minTier)) {
      throw new ValidationError(`Unknown membership tier '${String(spec.minTier)}'.`);
    }
    const capacity = requireIntegerInRange(spec.capacity, 'Capacity', 1, MAX_RESOURCE_CAPACITY);

    this._name = name;
    this._description = description;
    this._category = spec.category;
    this._minTier = spec.minTier;
    this._capacity = capacity;
  }
}
