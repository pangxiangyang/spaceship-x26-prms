import { describe, expect, it } from 'vitest';
import { CrewLead, Passenger } from '../../src/users/User';
import { MembershipTier } from '../../src/membership/MembershipTier';
import { ValidationError } from '../../src/shared/errors';

const base = { id: 'p-1', createdAt: new Date('2026-01-01T00:00:00Z') };

describe('Passenger', () => {
  it('normalises the username and trims the display name', () => {
    const p = Passenger.create({
      ...base,
      username: '  Ada.Lovelace ',
      displayName: '  Ada Lovelace ',
      tier: MembershipTier.SILVER,
    });
    expect(p.username).toBe('ada.lovelace');
    expect(p.displayName).toBe('Ada Lovelace');
    expect(p.role).toBe('PASSENGER');
  });

  it.each(['ab', 'has space', '-leadingdash', 'x'.repeat(33), 'emoji🚀'])(
    'rejects invalid username %j',
    (username) => {
      expect(() =>
        Passenger.create({ ...base, username, displayName: 'X', tier: MembershipTier.SILVER }),
      ).toThrow(ValidationError);
    },
  );

  it('rejects blank or overly long display names', () => {
    expect(() =>
      Passenger.create({ ...base, username: 'ada', displayName: '   ', tier: 'SILVER' }),
    ).toThrow(ValidationError);
    expect(() =>
      Passenger.create({ ...base, username: 'ada', displayName: 'x'.repeat(81), tier: 'SILVER' }),
    ).toThrow(ValidationError);
  });

  it('rejects unknown tiers', () => {
    expect(() =>
      Passenger.create({
        ...base,
        username: 'ada',
        displayName: 'Ada',
        tier: 'DIAMOND' as MembershipTier,
      }),
    ).toThrow(ValidationError);
  });

  it('inherits access to lower tiers', () => {
    const gold = Passenger.create({ ...base, username: 'ada', displayName: 'Ada', tier: 'GOLD' });
    expect(gold.hasAccessTo('SILVER')).toBe(true);
    expect(gold.hasAccessTo('GOLD')).toBe(true);
    expect(gold.hasAccessTo('PLATINUM')).toBe(false);
  });

  describe('changeTier', () => {
    it('reports an upgrade', () => {
      const p = Passenger.create({ ...base, username: 'ada', displayName: 'Ada', tier: 'SILVER' });
      expect(p.changeTier('PLATINUM')).toEqual({
        from: 'SILVER',
        to: 'PLATINUM',
        direction: 'UPGRADE',
      });
      expect(p.tier).toBe('PLATINUM');
    });

    it('reports a downgrade', () => {
      const p = Passenger.create({ ...base, username: 'ada', displayName: 'Ada', tier: 'GOLD' });
      expect(p.changeTier('SILVER').direction).toBe('DOWNGRADE');
    });

    it('rejects a change to the current tier', () => {
      const p = Passenger.create({ ...base, username: 'ada', displayName: 'Ada', tier: 'GOLD' });
      expect(() => p.changeTier('GOLD')).toThrow(ValidationError);
    });
  });
});

describe('CrewLead', () => {
  it('is created with the crew lead role', () => {
    const lead = CrewLead.create({ ...base, username: 'commander', displayName: 'Cmdr. Shepard' });
    expect(lead.role).toBe('CREW_LEAD');
  });
});
