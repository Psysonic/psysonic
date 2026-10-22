import { describe, expect, it } from 'vitest';
import { spreadShuffle, type ShuffleGroupKeys } from '@/lib/util/spreadShuffle';
import { shuffleArray } from '@/lib/util/shuffleArray';

type Item = { id: number; artist: string; album: string };

/** Seeded PRNG so every run sees the same draws. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const keys = (item: Item): ShuffleGroupKeys => ({ primary: item.artist, secondary: item.album });

function catalogue(artists: number, perArtist: number, albumsPerArtist = 1): Item[] {
  const items: Item[] = [];
  for (let a = 0; a < artists; a++) {
    for (let t = 0; t < perArtist; t++) {
      items.push({ id: a * 100 + t, artist: `artist-${a}`, album: `album-${a}-${t % albumsPerArtist}` });
    }
  }
  return items;
}

function neighbours(list: Item[], field: 'artist' | 'album'): number {
  let count = 0;
  for (let i = 1; i < list.length; i++) if (list[i][field] === list[i - 1][field]) count++;
  return count;
}

const RUNS = 200;

describe('spreadShuffle', () => {
  it('returns every item exactly once and leaves the input alone', () => {
    const input = catalogue(3, 4);
    const snapshot = [...input];
    const out = spreadShuffle(input, keys, { random: mulberry32(1) });
    expect(input).toEqual(snapshot);
    expect(out).toHaveLength(input.length);
    expect([...out].sort((a, b) => a.id - b.id)).toEqual([...input].sort((a, b) => a.id - b.id));
  });

  it('keeps an item that appears twice in the list twice', () => {
    const twin: Item = { id: 1, artist: 'a', album: 'x' };
    const other: Item = { id: 2, artist: 'b', album: 'y' };
    const out = spreadShuffle([twin, other, twin], keys, { random: mulberry32(3) });
    expect(out.filter(item => item === twin)).toHaveLength(2);
    expect(out).toHaveLength(3);
  });

  it('almost never plays the same artist twice in a row, where plain shuffle often does', () => {
    const input = catalogue(4, 5);
    let spread = 0;
    let plain = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      spread += neighbours(spreadShuffle(input, keys, { random: mulberry32(seed) }), 'artist');
      plain += neighbours(shuffleArray(input), 'artist');
    }
    // The baseline shows what the spreading is up against: about four
    // same-artist neighbours per shuffle of this list.
    expect(plain / RUNS).toBeGreaterThan(3);
    expect(spread / RUNS).toBeLessThan(0.1);
  });

  it('spreads the albums of one artist the same way', () => {
    const input = catalogue(1, 12, 3);
    let spread = 0;
    let plain = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      spread += neighbours(spreadShuffle(input, keys, { random: mulberry32(seed) }), 'album');
      plain += neighbours(shuffleArray(input), 'album');
    }
    expect(plain / RUNS).toBeGreaterThan(2);
    expect(spread / RUNS).toBeLessThan(0.2);
  });

  it('still mixes items it has no keys for', () => {
    const input = catalogue(1, 8);
    const orders = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const out = spreadShuffle(input, () => null, { random: mulberry32(seed) });
      expect(out).toHaveLength(input.length);
      orders.add(out.map(item => item.id).join(','));
    }
    expect(orders.has(input.map(item => item.id).join(','))).toBe(false);
    expect(orders.size).toBeGreaterThan(15);
  });

  it('does not open with the artist of the track that plays before the list', () => {
    const input = catalogue(4, 5);
    const leading = { primary: 'artist-0', secondary: 'album-0-0' };
    let openedWithLeading = 0;
    let withoutOption = 0;
    let neighboursWithOption = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const out = spreadShuffle(input, keys, { random: mulberry32(seed), leading });
      if (out[0].artist === 'artist-0') openedWithLeading++;
      neighboursWithOption += neighbours(out, 'artist');
      if (spreadShuffle(input, keys, { random: mulberry32(seed) })[0].artist === 'artist-0') withoutOption++;
    }
    // Without the option about a quarter of the runs open with that artist.
    expect(withoutOption).toBeGreaterThan(RUNS / 10);
    expect(openedWithLeading).toBe(0);
    // Moving the opener does not buy the fix with repeats further down.
    expect(neighboursWithOption / RUNS).toBeLessThan(0.1);
  });

  it('leaves the order alone when every item shares the leading artist', () => {
    const input = catalogue(1, 6, 2);
    const leading = { primary: 'artist-0', secondary: 'album-0-0' };
    const out = spreadShuffle(input, keys, { random: mulberry32(5), leading });
    expect(out).toEqual(spreadShuffle(input, keys, { random: mulberry32(5) }));
  });

  it('handles empty and single-item lists', () => {
    expect(spreadShuffle([], keys)).toEqual([]);
    const only: Item = { id: 1, artist: 'a', album: 'x' };
    expect(spreadShuffle([only], keys)).toEqual([only]);
  });
});
