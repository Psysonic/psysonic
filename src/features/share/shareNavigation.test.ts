import { describe, expect, it } from 'vitest';
import { selectAggregateShareCount } from '@/features/share/shareNavigation';

describe('share navigation count', () => {
  it('counts shares across every server and ignores availability', () => {
    expect(selectAggregateShareCount({
      byServer: {
        available: {
          shares: [{ id: 'one', url: 'https://one.test' }],
          loading: false,
          lastSuccessfulRefresh: 1,
          availability: 'available',
        },
        disabled: {
          shares: [],
          loading: false,
          lastSuccessfulRefresh: null,
          availability: 'sharing_disabled',
        },
        unreachableWithCachedRow: {
          shares: [{ id: 'two', url: 'https://two.test' }],
          loading: false,
          lastSuccessfulRefresh: 1,
          availability: 'server_unavailable',
        },
      },
    })).toBe(2);
  });
});
