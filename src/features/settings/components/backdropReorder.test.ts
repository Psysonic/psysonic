import { describe, it, expect } from 'vitest';
import { moveSourceTo, dropSourceBefore, mergeVisibleSources } from '@/features/settings/components/backdropReorder';
import type { BackdropSource, BackdropSourcePref } from '@/cover/artistBackdrop';

const S = (...names: BackdropSource[]): BackdropSourcePref[] =>
  names.map((source) => ({ source, enabled: true }));
const ids = (arr: BackdropSourcePref[] | null) => arr?.map((p) => p.source);

describe('moveSourceTo (↑/↓ buttons — land at exact index)', () => {
  it('moves an item up to a lower index', () => {
    expect(ids(moveSourceTo(S('navidrome', 'banner', 'fanart'), 2, 0))).toEqual(['fanart', 'navidrome', 'banner']);
  });
  it('moves an item down to a higher index', () => {
    expect(ids(moveSourceTo(S('banner', 'fanart', 'navidrome'), 0, 1))).toEqual(['fanart', 'banner', 'navidrome']);
  });
  it('returns null on a no-op or out-of-range move', () => {
    expect(moveSourceTo(S('banner', 'fanart'), 1, 1)).toBeNull();
    expect(moveSourceTo(S('banner', 'fanart'), 0, 5)).toBeNull();
  });
});

describe('dropSourceBefore (drag-drop — insert before target row)', () => {
  it('drops before a lower row (dragging up)', () => {
    expect(ids(dropSourceBefore(S('banner', 'fanart', 'navidrome'), 2, 0))).toEqual(['navidrome', 'banner', 'fanart']);
  });
  it('drops before a higher row (dragging down), accounting for the vacated slot', () => {
    // drag `banner` onto `navidrome` → lands between fanart and navidrome
    expect(ids(dropSourceBefore(S('banner', 'fanart', 'navidrome'), 0, 2))).toEqual(['fanart', 'banner', 'navidrome']);
  });
  it('dropping just before the next row leaves the order unchanged', () => {
    expect(ids(dropSourceBefore(S('banner', 'fanart', 'navidrome'), 0, 1))).toEqual(['banner', 'fanart', 'navidrome']);
  });
  it('returns null when dropping a row onto itself', () => {
    expect(dropSourceBefore(S('banner', 'fanart'), 1, 1)).toBeNull();
  });
});

describe('mergeVisibleSources (edit of a filtered list)', () => {
  it('keeps hidden rows in place and applies the visible switch', () => {
    const full = S('fanart', 'navidrome', 'banner');
    const merged = mergeVisibleSources(full, [{ source: 'navidrome', enabled: false }]);
    expect(merged).toEqual([
      { source: 'fanart', enabled: true },
      { source: 'navidrome', enabled: false },
      { source: 'banner', enabled: true },
    ]);
  });
  it('puts reordered visible rows into the slots the visible rows held', () => {
    const merged = mergeVisibleSources(S('fanart', 'navidrome', 'banner'), S('banner', 'fanart'));
    expect(ids(merged)).toEqual(['banner', 'navidrome', 'fanart']);
  });
});
