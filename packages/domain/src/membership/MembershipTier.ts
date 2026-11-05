/**
 * Membership tiers, ordered from lowest to highest.
 *
 * Access follows a single rule: a passenger may use a resource when their tier
 * ranks at or above the resource's minimum tier ("higher levels inherit
 * lower-level access"). Adding a new tier means adding one entry here.
 */
export const MembershipTier = {
  SILVER: 'SILVER',
  GOLD: 'GOLD',
  PLATINUM: 'PLATINUM',
} as const;

export type MembershipTier = (typeof MembershipTier)[keyof typeof MembershipTier];

const TIER_RANK: Readonly<Record<MembershipTier, number>> = {
  SILVER: 1,
  GOLD: 2,
  PLATINUM: 3,
};

export const ALL_TIERS: readonly MembershipTier[] = Object.freeze(
  (Object.keys(TIER_RANK) as MembershipTier[]).sort((a, b) => TIER_RANK[a] - TIER_RANK[b]),
);

export function isMembershipTier(value: unknown): value is MembershipTier {
  return typeof value === 'string' && Object.hasOwn(TIER_RANK, value);
}

export function compareTiers(a: MembershipTier, b: MembershipTier): number {
  return TIER_RANK[a] - TIER_RANK[b];
}

/** True when a passenger holding `held` may access something requiring `required`. */
export function tierIncludes(held: MembershipTier, required: MembershipTier): boolean {
  return compareTiers(held, required) >= 0;
}
