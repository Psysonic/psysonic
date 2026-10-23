import { beforeEach, describe, expect, it } from 'vitest';
import { readTagCatalogReturnState, tagCatalogPopularityLog } from './tagCatalogSession';

describe('tag catalog session helpers', () => {
  beforeEach(() => sessionStorage.clear());

  it.each(['null', 'false', '42', '{}', '{broken', '{"search":1,"scrollTop":0}'])('ignores invalid saved state %s', raw => {
    sessionStorage.setItem('catalog', raw);
    expect(readTagCatalogReturnState('catalog')).toBeNull();
  });

  it('restores search and clamps a negative scroll position', () => {
    sessionStorage.setItem('catalog', JSON.stringify({ search: 'Dream', scrollTop: -50 }));
    expect(readTagCatalogReturnState('catalog')).toEqual({ search: 'Dream', scrollTop: 0 });
  });

  it('sizes against the full catalog without an argument-count limit', () => {
    expect(tagCatalogPopularityLog([])).toBe(1);
    const rows = Array.from({ length: 150_000 }, () => ({ albumCount: 2 }));
    rows[42] = { albumCount: 100 };
    expect(tagCatalogPopularityLog(rows)).toBe(Math.log(100));
  });
});
