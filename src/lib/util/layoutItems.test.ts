import { describe, expect, it } from 'vitest';
import { isLayoutCustomized, mergeLayoutItems, type LayoutItem } from './layoutItems';

type Id = 'a' | 'b' | 'c' | 'd';
const DEFAULTS: LayoutItem<Id>[] = [
  { id: 'a', visible: true },
  { id: 'b', visible: true },
  { id: 'c', visible: true },
  { id: 'd', visible: false },
];

describe('mergeLayoutItems', () => {
  it('returns the defaults for missing or corrupt input', () => {
    expect(mergeLayoutItems(undefined, DEFAULTS)).toEqual(DEFAULTS);
    expect(mergeLayoutItems('nope', DEFAULTS)).toEqual(DEFAULTS);
    expect(mergeLayoutItems([null, { id: 'a' }, { visible: true }], DEFAULTS)).toEqual(DEFAULTS);
  });

  it('keeps the persisted order and visibility', () => {
    const persisted = [
      { id: 'c', visible: false },
      { id: 'a', visible: true },
      { id: 'd', visible: true },
      { id: 'b', visible: false },
    ];
    expect(mergeLayoutItems(persisted, DEFAULTS)).toEqual(persisted);
  });

  it('drops unknown ids and duplicates', () => {
    const persisted = [
      { id: 'b', visible: false },
      { id: 'zzz', visible: true },
      { id: 'b', visible: true },
      { id: 'a', visible: true },
      { id: 'c', visible: true },
      { id: 'd', visible: false },
    ];
    expect(mergeLayoutItems(persisted, DEFAULTS).map(i => `${i.id}:${i.visible}`))
      .toEqual(['b:false', 'a:true', 'c:true', 'd:false']);
  });

  it('inserts missing leading defaults at the front, not at the end', () => {
    const persisted = [
      { id: 'd', visible: true },
      { id: 'c', visible: false },
    ];
    expect(mergeLayoutItems(persisted, DEFAULTS).map(i => i.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('inserts a missing default right after its nearest present predecessor', () => {
    const persisted = [
      { id: 'c', visible: true },
      { id: 'a', visible: false },
      { id: 'd', visible: true },
    ];
    const merged = mergeLayoutItems(persisted, DEFAULTS);
    expect(merged.map(i => i.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(merged.find(i => i.id === 'b')?.visible).toBe(true);
  });

  it('does not mutate the defaults it copies from', () => {
    const merged = mergeLayoutItems([], DEFAULTS);
    merged[0].visible = false;
    expect(DEFAULTS[0].visible).toBe(true);
  });
});

describe('isLayoutCustomized', () => {
  it('is false for the defaults and true for any order or visibility change', () => {
    expect(isLayoutCustomized(DEFAULTS, DEFAULTS)).toBe(false);
    expect(isLayoutCustomized([DEFAULTS[1], DEFAULTS[0], DEFAULTS[2], DEFAULTS[3]], DEFAULTS)).toBe(true);
    expect(isLayoutCustomized(DEFAULTS.map(d => ({ ...d, visible: !d.visible })), DEFAULTS)).toBe(true);
    expect(isLayoutCustomized(DEFAULTS.slice(1), DEFAULTS)).toBe(true);
  });
});
