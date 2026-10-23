import { describe, expect, it } from 'vitest';
import { withoutRatingColumn } from '@/store/starRatings';

describe('withoutRatingColumn', () => {
  const cols = [{ key: 'title' }, { key: 'rating' }, { key: 'duration' }];

  it('keeps every column while ratings are shown', () => {
    expect(withoutRatingColumn(cols, true)).toBe(cols);
  });

  it('drops only the rating column while ratings are hidden', () => {
    expect(withoutRatingColumn(cols, false).map(c => c.key)).toEqual(['title', 'duration']);
  });
});
