import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundedTtlCache } from '@/lib/cache/boundedTtlCache';

describe('createBoundedTtlCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns stored values and null for unknown keys', () => {
    const cache = createBoundedTtlCache<number>(1000, 4);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeNull();
  });

  it('expires entries older than the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cache = createBoundedTtlCache<number>(1000, 4);
    cache.set('a', 1);
    vi.setSystemTime(1000);
    expect(cache.get('a')).toBe(1);
    vi.setSystemTime(1001);
    expect(cache.get('a')).toBeNull();
  });

  it('evicts the oldest entry once over the limit, counting rewrites as new', () => {
    const cache = createBoundedTtlCache<number>(1000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    cache.set('c', 4);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toBe(3);
    expect(cache.get('c')).toBe(4);
  });

  it('clear removes everything', () => {
    const cache = createBoundedTtlCache<number>(1000, 2);
    cache.set('a', 1);
    cache.clear();
    expect(cache.get('a')).toBeNull();
  });
});
