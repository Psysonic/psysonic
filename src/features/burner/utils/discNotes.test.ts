import { describe, expect, it } from 'vitest';
import {
  ABSENT_GLYPH, MAX_NOTES, NOTE_GLYPHS, PARTICLE_REF_W, STEADY_NOTE_CHANCE, TRACK_CHANGE_NOTES,
  clearCanvas, noteAlpha, noteCoreAlpha, noteGlowBlur, noteGrowth, noteSize, noteSpeed,
  noteVelocity, notesToEmit, particleScale, sparkSize, sparkSpeed, stepNote, usableGlyphs,
  type NoteParticle,
} from './discNotes';

/** The two disc widths every proportional claim below is checked at. */
const SMALL = PARTICLE_REF_W;
const LARGE = 940;

/** A note in flight, with only what the test cares about spelled out. */
function note(over: Partial<NoteParticle> = {}): NoteParticle {
  return {
    x: 0, y: 0, vx: 0, vy: 0,
    life: 1, max: 1, size: 16,
    rotation: 0, spin: 0,
    glyph: NOTE_GLYPHS[0], rgb: [255, 255, 255],
    ...over,
  };
}

/**
 * A font that draws `has` and answers with its `.notdef` advance for anything
 * else — which is exactly what a real canvas does for a glyph it is missing.
 */
function fontWith(has: readonly string[], notdef = 12): (text: string) => number {
  return text => (has.includes(text) ? 9 : notdef);
}

describe('usableGlyphs', () => {
  it('keeps every note a font actually draws', () => {
    expect(usableGlyphs(fontWith(NOTE_GLYPHS))).toEqual([...NOTE_GLYPHS]);
  });

  it('drops the ones that come back at the notdef width', () => {
    // The Windows/macOS/Linux stack covers all four, but a host font that is
    // missing the beamed pair must lose them rather than draw tofu.
    const partial = [NOTE_GLYPHS[0], NOTE_GLYPHS[1]];
    expect(usableGlyphs(fontWith(partial))).toEqual(partial);
  });

  it('measures the miss against a codepoint no font maps', () => {
    const asked: string[] = [];
    usableGlyphs(text => { asked.push(text); return text === ABSENT_GLYPH ? 12 : 9; });
    expect(asked[0]).toBe(ABSENT_GLYPH);
    expect(asked).toHaveLength(NOTE_GLYPHS.length + 1);
  });

  it('keeps the whole set when the font answers identically for everything', () => {
    // A fixed-advance fallback tells us nothing, and switching the effect off
    // on no evidence is worse than drawing what the font offers.
    expect(usableGlyphs(() => 12)).toEqual([...NOTE_GLYPHS]);
  });

  it('keeps the whole set when there is no measurement to be had', () => {
    expect(usableGlyphs(() => 0)).toEqual([...NOTE_GLYPHS]);
    expect(usableGlyphs(() => Number.NaN)).toEqual([...NOTE_GLYPHS]);
  });

  it('accepts a glyph set of its own', () => {
    expect(usableGlyphs(fontWith(['a']), ['a', 'b'])).toEqual(['a']);
  });
});

describe('notesToEmit', () => {
  it('throws a burst as the head crosses into a new track', () => {
    expect(notesToEmit(true, 0, 1)).toBe(TRACK_CHANGE_NOTES);
  });

  it('trickles at the steady rate the rest of the time', () => {
    expect(notesToEmit(false, 0, STEADY_NOTE_CHANCE - 0.001)).toBe(1);
    expect(notesToEmit(false, 0, STEADY_NOTE_CHANCE)).toBe(0);
    expect(notesToEmit(false, 0, 0.99)).toBe(0);
  });

  it('keeps enough notes in the air to read as a stream', () => {
    // At 60fps and a ~1.3s life, the notes alive settle at chance * 60 * 1.3.
    // The reference shows ten to eighteen during continuous writing; the 0.07
    // this replaced settled at about five, which reads as the odd stray rather
    // than as something coming off the laser.
    const alive = STEADY_NOTE_CHANCE * 60 * 1.3;
    expect(alive).toBeGreaterThanOrEqual(10);
    expect(alive).toBeLessThanOrEqual(18);
    expect(alive).toBeLessThan(MAX_NOTES);
  });

  it('enforces the ceiling rather than leaving it as a constant', () => {
    expect(notesToEmit(true, MAX_NOTES - 3, 1)).toBe(3);
    expect(notesToEmit(false, MAX_NOTES, 0)).toBe(0);
  });

  it('never asks for a negative number of notes', () => {
    expect(notesToEmit(true, MAX_NOTES + 20, 1)).toBe(0);
  });
});

describe('proportional particle sizing', () => {
  it('scales every note dimension with the disc, not with a pixel constant', () => {
    // The whole bug: these were fixed pixels on an element that runs from
    // ~350px wide to ~900, so the effect shrank against its own disc.
    for (const roll of [0, 0.5, 1]) {
      expect(noteSize(LARGE, roll) / noteSize(SMALL, roll)).toBeCloseTo(LARGE / SMALL, 6);
      expect(sparkSize(LARGE, roll) / sparkSize(SMALL, roll)).toBeCloseTo(LARGE / SMALL, 6);
      expect(sparkSpeed(LARGE, roll) / sparkSpeed(SMALL, roll)).toBeCloseTo(LARGE / SMALL, 6);
      expect(noteSpeed(LARGE, 1.3, roll) / noteSpeed(SMALL, 1.3, roll))
        .toBeCloseTo(LARGE / SMALL, 6);
    }
  });

  it('draws notes at 4.0% to 5.3% of the disc', () => {
    expect(noteSize(LARGE, 0) / LARGE).toBeCloseTo(0.04, 6);
    expect(noteSize(LARGE, 1) / LARGE).toBeCloseTo(0.053, 6);
  });

  it('draws sparks as small squares rather than pinpricks', () => {
    expect(sparkSize(LARGE, 0) / LARGE).toBeCloseTo(0.004, 6);
    expect(sparkSize(LARGE, 1) / LARGE).toBeCloseTo(0.007, 6);
  });

  it('carries a note 16% to 27% of the disc whatever life it drew', () => {
    // Stated as reach and divided by life precisely so the two shortest- and
    // longest-lived notes cover the same band. A fixed speed spread the travel
    // over nearly a factor of two and the short-lived ones never got clear of
    // the head.
    for (const life of [0.9, 1.3, 1.7]) {
      expect((noteSpeed(LARGE, life, 0) * life) / LARGE).toBeCloseTo(0.16, 6);
      expect((noteSpeed(LARGE, life, 1) * life) / LARGE).toBeCloseTo(0.27, 6);
    }
  });

  it('cannot divide by a note with no life', () => {
    expect(noteSpeed(LARGE, 0, 0.5)).toBe(0);
    expect(noteSpeed(LARGE, -1, 0.5)).toBe(0);
    expect(noteSpeed(LARGE, Number.NaN, 0.5)).toBe(0);
  });

  it('lands back on the numbers that shipped at the width they were tuned at', () => {
    // The other half of the contract: a narrow window must look exactly as it
    // did. The old ranges were 13-23px glyphs, 1-3.2px sparks and 40-160px/s.
    expect(particleScale(SMALL)).toBe(1);
    expect(noteSize(SMALL, 0)).toBeCloseTo(14, 6);
    expect(noteSize(SMALL, 1)).toBeCloseTo(18.55, 6);
    expect(sparkSize(SMALL, 0)).toBeCloseTo(1.4, 6);
    expect(sparkSize(SMALL, 1)).toBeCloseTo(2.45, 6);
    expect(sparkSpeed(SMALL, 0)).toBeCloseTo(40, 6);
    expect(sparkSpeed(SMALL, 1)).toBeCloseTo(160, 6);
  });

  it('never scales a particle by a negative disc', () => {
    expect(particleScale(0)).toBe(0);
    expect(particleScale(-500)).toBe(0);
  });
});

describe('noteVelocity', () => {
  it('always carries the note outward, whatever the sway', () => {
    const rad = 0.7;
    for (const sway of [-0.7, -0.2, 0, 0.35, 0.7]) {
      const { vx, vy } = noteVelocity(rad, sway, 40);
      // The outward component is the projection onto the radial unit vector.
      expect(vx * Math.cos(rad) + vy * Math.sin(rad)).toBeCloseTo(40, 6);
    }
  });

  it('leaves to both sides of the head', () => {
    const rad = 0;
    const left = noteVelocity(rad, -0.5, 40);
    const right = noteVelocity(rad, 0.5, 40);
    expect(left.vy).toBeLessThan(0);
    expect(right.vy).toBeGreaterThan(0);
    expect(noteVelocity(rad, 0, 40).vy).toBeCloseTo(0, 6);
  });
});

describe('stepNote', () => {
  it('spends life and reports the note gone once it runs out', () => {
    const n = note({ life: 0.05 });
    expect(stepNote(n, 0.02)).toBe(true);
    expect(n.life).toBeCloseTo(0.03, 6);
    expect(stepNote(n, 0.05)).toBe(false);
  });

  it('lifts the note rather than dropping it', () => {
    const n = note({ vy: 0 });
    stepNote(n, 0.1);
    expect(n.vy).toBeCloseTo(-0.7, 6);
  });

  it('drags the sideways travel but not the rise', () => {
    const n = note({ vx: 100, vy: -50 });
    stepNote(n, 0.1);
    expect(n.vx).toBeCloseTo(99.2, 6);
    // -50 moved only by the lift, with no drag of its own.
    expect(n.vy).toBeCloseTo(-50.7, 6);
  });

  it('integrates position and rotation from the stepped velocity', () => {
    const n = note({ x: 10, y: 20, vx: 100, vy: 0, rotation: 0.5, spin: 2 });
    stepNote(n, 0.1);
    expect(n.x).toBeCloseTo(10 + 99.2 * 0.1, 6);
    expect(n.y).toBeCloseTo(20 + -0.7 * 0.1, 6);
    expect(n.rotation).toBeCloseTo(0.7, 6);
  });
});

describe('noteAlpha', () => {
  it('holds full opacity for most of the flight', () => {
    expect(noteAlpha({ life: 1.6, max: 1.6 })).toBe(1);
    expect(noteAlpha({ life: 0.8, max: 1.6 })).toBe(1);
  });

  it('fades only over the last stretch', () => {
    expect(noteAlpha({ life: 0.16, max: 1.6 })).toBeCloseTo(0.25, 6);
    expect(noteAlpha({ life: 0, max: 1.6 })).toBe(0);
  });

  it('cannot divide by a note with no lifetime', () => {
    expect(noteAlpha({ life: 1, max: 0 })).toBe(0);
  });
});

describe('noteCoreAlpha', () => {
  it('is white-hot at birth', () => {
    expect(noteCoreAlpha({ life: 1.6, max: 1.6 })).toBeCloseTo(1, 6);
  });

  it('leaves faster than the coloured halo does', () => {
    // The whole point: a note is born white and dies the track's colour. If
    // the two alphas ever move together the note is a flat white glyph for its
    // entire flight, which is the fault this replaced.
    for (const life of [1.2, 0.8, 0.4, 0.16]) {
      const n = { life, max: 1.6 };
      expect(noteCoreAlpha(n)).toBeLessThan(noteAlpha(n));
    }
    expect(noteCoreAlpha({ life: 0.8, max: 1.6 })).toBeCloseTo(0.25, 6);
  });

  it('can never outlive the note it belongs to', () => {
    expect(noteCoreAlpha({ life: 0, max: 1.6 })).toBe(0);
    expect(noteCoreAlpha({ life: -1, max: 1.6 })).toBe(0);
    expect(noteCoreAlpha({ life: 1, max: 0 })).toBe(0);
  });
});

describe('noteGlowBlur', () => {
  it('puts a halo roughly twice the glyph across it', () => {
    // A blur radius of half the glyph reaches half a glyph past each edge,
    // which is a halo about twice the glyph wide.
    expect(noteGlowBlur(40)).toBeCloseTo(20, 6);
  });

  it('grows with the glyph rather than staying a constant', () => {
    // A fixed blur is a halo that shrinks against the glyph as the glyph
    // grows, which is how notes on a large disc came out flat and unlit.
    expect(noteGlowBlur(80) / noteGlowBlur(20)).toBeCloseTo(4, 6);
  });
});

describe('clearCanvas', () => {
  /** A context that records the order it was called in. */
  function recorder() {
    const calls: string[] = [];
    return {
      calls,
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        calls.push(`setTransform(${a},${b},${c},${d},${e},${f})`);
      },
      clearRect(x: number, y: number, w: number, h: number) {
        calls.push(`clearRect(${x},${y},${w},${h})`);
      },
    };
  }

  it('resets to the identity transform BEFORE it clears', () => {
    // This is the whole function, and it is not defensive tidying. The frame
    // loop leaves the spark context under the canvas-inflation offset, a 2D
    // context belongs to its canvas and outlives the effect that set it, and
    // `clearRect` takes user coordinates — so a bare clear of (0,0,w,h) began
    // at the padded origin and left the top and left inflation bands holding
    // whatever was last drawn there. Notes still in flight above the disc's
    // rim when a burn ended stayed frozen on screen after the eject.
    const ctx = recorder();
    clearCanvas(ctx, 1200, 900);
    expect(ctx.calls).toEqual(['setTransform(1,0,0,1,0,0)', 'clearRect(0,0,1200,900)']);
  });

  it('clears the whole backing store it was handed', () => {
    const ctx = recorder();
    clearCanvas(ctx, 7, 11);
    expect(ctx.calls[1]).toBe('clearRect(0,0,7,11)');
  });
});

describe('noteGrowth', () => {
  it('swells as the note fades', () => {
    expect(noteGrowth({ life: 1 })).toBeCloseTo(1, 6);
    expect(noteGrowth({ life: 0 })).toBeCloseTo(1.18, 6);
    expect(noteGrowth({ life: 0.5 })).toBeCloseTo(1.09, 6);
  });
});
