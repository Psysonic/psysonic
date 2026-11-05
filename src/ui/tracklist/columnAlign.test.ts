import { describe, expect, it } from 'vitest';
import { columnAlign } from '@/ui/tracklist/columnAlign';

const col = (key: string, align?: 'start' | 'center' | 'end') =>
  ({ key, minWidth: 50, defaultWidth: 80, required: false, ...(align ? { align } : {}) });

describe('columnAlign', () => {
  it('keeps the name columns on the left', () => {
    expect(columnAlign(col('title'))).toBe('start');
    expect(columnAlign(col('artist'))).toBe('start');
    expect(columnAlign(col('album'))).toBe('start');
  });

  it('keeps the track number on the right', () => {
    expect(columnAlign(col('num'))).toBe('end');
  });

  // Mixed left/right neighbours stick together at their shared divider; centred
  // they keep their distance however wide the columns are dragged.
  it('centres every other column', () => {
    for (const key of ['duration', 'genre', 'format', 'playCount', 'lastPlayed', 'bpm', 'favorite', 'rating', 'year', 'songs', 'added', 'mood', 'genres']) {
      expect(columnAlign(col(key))).toBe('center');
    }
  });

  it('lets a column state its own alignment', () => {
    expect(columnAlign(col('duration', 'end'))).toBe('end');
  });
});
