import { describe, expect, it } from 'vitest';
import { Resource } from '../../src/resources/Resource';
import { ConflictError, ValidationError } from '../../src/shared/errors';

const spec = {
  id: 'r-1',
  createdAt: new Date('2026-03-01T00:00:00Z'),
  name: '  Private Cabin 7 ',
  category: 'CABIN' as const,
  minTier: 'GOLD' as const,
  capacity: 2,
};

describe('Resource', () => {
  it('is provisioned active with trimmed fields', () => {
    const r = Resource.provision(spec);
    expect(r.name).toBe('Private Cabin 7');
    expect(r.description).toBe('');
    expect(r.isActive).toBe(true);
  });

  it('is accessible to its minimum tier and above', () => {
    const r = Resource.provision(spec);
    expect(r.isAccessibleTo('SILVER')).toBe(false);
    expect(r.isAccessibleTo('GOLD')).toBe(true);
    expect(r.isAccessibleTo('PLATINUM')).toBe(true);
  });

  it.each([
    [{ name: ' ' }],
    [{ capacity: 0 }],
    [{ capacity: 1.5 }],
    [{ capacity: 501 }],
    [{ category: 'SPA' }],
    [{ minTier: 'BRONZE' }],
    [{ description: 'x'.repeat(281) }],
  ])('rejects invalid spec %j', (override) => {
    expect(() => Resource.provision({ ...spec, ...(override as object) })).toThrow(ValidationError);
  });

  it('applies valid updates and leaves state untouched when an update is invalid', () => {
    const r = Resource.provision(spec);
    r.update({ capacity: 4, description: 'Quiet deck' });
    expect(r.capacity).toBe(4);
    expect(r.description).toBe('Quiet deck');

    expect(() => r.update({ name: 'Renamed', capacity: -1 })).toThrow(ValidationError);
    expect(r.name).toBe('Private Cabin 7');
    expect(r.capacity).toBe(4);
  });

  it('cannot be updated or decommissioned once decommissioned', () => {
    const r = Resource.provision(spec);
    r.decommission(new Date('2026-03-02T00:00:00Z'));
    expect(r.status).toBe('DECOMMISSIONED');
    expect(() => r.update({ capacity: 3 })).toThrow(ConflictError);
    expect(() => r.decommission(new Date())).toThrow(ConflictError);
  });
});
