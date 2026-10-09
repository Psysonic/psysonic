import { describe, expect, it } from 'vitest';
import { hasExplicitTrack, isExplicit } from '@/lib/media/explicitStatus';

describe('explicitStatus', () => {
  it('marks only the explicit value', () => {
    expect(isExplicit({ explicitStatus: 'explicit' })).toBe(true);
    expect(isExplicit({ explicitStatus: 'clean' })).toBe(false);
    expect(isExplicit({ explicitStatus: '' })).toBe(false);
    expect(isExplicit({})).toBe(false);
    expect(isExplicit(null)).toBe(false);
  });

  it('treats an album as explicit once one of its tracks is', () => {
    expect(hasExplicitTrack([{ explicitStatus: 'clean' }, { explicitStatus: 'explicit' }])).toBe(true);
    expect(hasExplicitTrack([{ explicitStatus: 'clean' }, {}])).toBe(false);
    expect(hasExplicitTrack([])).toBe(false);
  });
});
