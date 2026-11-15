import { describe, expect, it } from 'vitest';
import { isLyricsZoomWheel, normalizeLyricsScale } from './lyricsAppearance';

describe('lyrics appearance', () => {
  it.each([undefined, null, NaN, Infinity, -Infinity, '1.5', {}, true])('defaults invalid scale %s', value => {
    expect(normalizeLyricsScale(value)).toBe(1);
  });
  it.each([[-1, 0.5], [0.5, 0.5], [1, 1], [1.31, 1.3], [1.999, 2], [9, 2]])('clamps and rounds %s', (value, expected) => {
    expect(normalizeLyricsScale(value)).toBe(expected);
  });
  it('only accepts modified vertical wheel movement', () => {
    const event = { ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 1 };
    expect(isLyricsZoomWheel(event)).toBe(false);
    expect(isLyricsZoomWheel({ ...event, ctrlKey: true })).toBe(true);
    expect(isLyricsZoomWheel({ ...event, metaKey: true, deltaY: -1 })).toBe(true);
    expect(isLyricsZoomWheel({ ...event, ctrlKey: true, deltaX: 2 })).toBe(false);
    expect(isLyricsZoomWheel({ ...event, ctrlKey: true, deltaY: 0 })).toBe(false);
    expect(isLyricsZoomWheel({ ...event, ctrlKey: true, deltaY: NaN })).toBe(false);
  });
});
