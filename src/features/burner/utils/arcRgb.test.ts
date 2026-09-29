import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePalette, resolveRgb } from './arcRgb';
import { arcColor, arcPalette } from './arcColor';

/**
 * A canvas that normalises colour syntax the way a browser's does.
 *
 * jsdom has no 2D context at all, so without this every lookup would fall
 * through to the white fallback and the tests would pass whatever the code
 * did — which is exactly the hole that let the real bug live: the geometry
 * test's colour fixture was hex, so nothing ever fed the resolver a value the
 * palette actually produces.
 */
function stubCanvas() {
  const state = { fillStyle: '#000000' };
  const ctx = {
    get fillStyle() { return state.fillStyle; },
    set fillStyle(value: string) {
      const hex = /^#([\da-f]{6})$/i.exec(value);
      if (hex) { state.fillStyle = `#${hex[1].toLowerCase()}`; return; }
      const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value);
      if (short) {
        state.fillStyle = `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
        return;
      }
      if (/^rgba?\(/i.test(value)) { state.fillStyle = value; return; }
      if (value === 'rebeccapurple') { state.fillStyle = '#663399'; return; }
      // Anything the browser cannot parse leaves fillStyle untouched.
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
}

describe('resolveRgb', () => {
  beforeEach(() => {
    stubCanvas();
    document.documentElement.style.setProperty('--ctp-mauve', '#cba6f7');
    document.documentElement.style.setProperty('--ctp-peach', '#fab387');
    document.documentElement.style.setProperty('--ctp-pink', '#f5c2e7');
    document.documentElement.style.setProperty('--ctp-yellow', '#f9e2af');
    // Deliberately not hex, to prove the reader is not hex-only again.
    document.documentElement.style.setProperty('--ctp-green', 'rgb(166, 227, 161)');
    document.documentElement.style.setProperty('--ctp-sky', '#8de');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('style');
  });

  it('follows a var() to the value the theme holds', () => {
    // The whole point. Every colour the ring uses is a var(), and the reader
    // this replaced took hex only — so it returned white for all of them and
    // every spark on the disc was white, for every track.
    expect(resolveRgb('var(--ctp-mauve)')).toEqual([203, 166, 247]);
  });

  it('resolves every colour the palette can actually produce', () => {
    for (let i = 0; i < 24; i++) {
      expect(resolveRgb(arcColor(i))).not.toEqual([255, 255, 255]);
    }
  });

  it('reads a theme colour written as rgb() just as well as hex', () => {
    expect(resolveRgb('var(--ctp-green)')).toEqual([166, 227, 161]);
  });

  it('expands a three-digit hex', () => {
    expect(resolveRgb('var(--ctp-sky)')).toEqual([136, 221, 238]);
  });

  it('takes a plain colour with no var() at all', () => {
    expect(resolveRgb('#fab387')).toEqual([250, 179, 135]);
    expect(resolveRgb('rebeccapurple')).toEqual([102, 51, 153]);
  });

  it('falls back to the var()s own fallback when the theme is silent', () => {
    expect(resolveRgb('var(--nothing-defines-this, #fab387)')).toEqual([250, 179, 135]);
  });

  it('gives white rather than throwing on a colour it cannot read', () => {
    expect(resolveRgb('var(--nothing-defines-this)')).toEqual([255, 255, 255]);
    expect(resolveRgb('not a colour')).toEqual([255, 255, 255]);
    expect(resolveRgb('')).toEqual([255, 255, 255]);
  });
});

describe('resolvePalette', () => {
  beforeEach(() => {
    stubCanvas();
    document.documentElement.style.setProperty('--ctp-mauve', '#cba6f7');
    document.documentElement.style.setProperty('--ctp-peach', '#fab387');
    document.documentElement.style.setProperty('--ctp-sky', '#89dceb');
    document.documentElement.style.setProperty('--ctp-green', '#a6e3a1');
    document.documentElement.style.setProperty('--ctp-pink', '#f5c2e7');
    document.documentElement.style.setProperty('--ctp-yellow', '#f9e2af');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('style');
  });

  it('keys the map by the token the slices carry and holds the colour it read', () => {
    // Checking only that the key is present is what let the bug in the file
    // header ship: a map of six identical whites has every key the slices ask
    // for, so a lookup never missed and every spark on the disc was white
    // anyway. The value has to be the colour the resolver actually reads.
    const palette = resolvePalette(arcPalette());
    for (let i = 0; i < 12; i++) {
      const colour = arcColor(i);
      expect(palette.get(colour)).toEqual(resolveRgb(colour));
    }
    // And they cannot all be the same colour, whatever that colour is.
    const distinct = new Set([...palette.values()].map(rgb => rgb.join(',')));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('gives every track in the palette a distinct colour', () => {
    const seen = new Set(
      arcPalette().map(color => resolveRgb(color).join(',')),
    );
    expect(seen.size).toBe(arcPalette().length);
  });
});
