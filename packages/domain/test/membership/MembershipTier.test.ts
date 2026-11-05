import { describe, expect, it } from 'vitest';
import {
  ALL_TIERS,
  MembershipTier,
  compareTiers,
  isMembershipTier,
  tierIncludes,
} from '../../src/membership/MembershipTier';

describe('MembershipTier', () => {
  it('lists tiers from lowest to highest', () => {
    expect(ALL_TIERS).toEqual(['SILVER', 'GOLD', 'PLATINUM']);
  });

  describe('tierIncludes (higher levels inherit lower-level access)', () => {
    it.each([
      [MembershipTier.SILVER, MembershipTier.SILVER, true],
      [MembershipTier.SILVER, MembershipTier.GOLD, false],
      [MembershipTier.SILVER, MembershipTier.PLATINUM, false],
      [MembershipTier.GOLD, MembershipTier.SILVER, true],
      [MembershipTier.GOLD, MembershipTier.GOLD, true],
      [MembershipTier.GOLD, MembershipTier.PLATINUM, false],
      [MembershipTier.PLATINUM, MembershipTier.SILVER, true],
      [MembershipTier.PLATINUM, MembershipTier.GOLD, true],
      [MembershipTier.PLATINUM, MembershipTier.PLATINUM, true],
    ])('a %s passenger accessing a %s resource -> %s', (held, required, expected) => {
      expect(tierIncludes(held, required)).toBe(expected);
    });
  });

  it('compares tiers by rank', () => {
    expect(compareTiers(MembershipTier.GOLD, MembershipTier.SILVER)).toBeGreaterThan(0);
    expect(compareTiers(MembershipTier.GOLD, MembershipTier.PLATINUM)).toBeLessThan(0);
    expect(compareTiers(MembershipTier.GOLD, MembershipTier.GOLD)).toBe(0);
  });

  it('recognises valid tier values only', () => {
    expect(isMembershipTier('GOLD')).toBe(true);
    expect(isMembershipTier('gold')).toBe(false);
    expect(isMembershipTier('DIAMOND')).toBe(false);
    expect(isMembershipTier(undefined)).toBe(false);
  });
});
