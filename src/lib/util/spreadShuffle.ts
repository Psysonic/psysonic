/**
 * Shuffle that spreads items sharing a key over the whole result instead of
 * leaving their spacing to chance. Plain Fisher-Yates happily puts three songs
 * by one artist in a row; here each artist is dealt out at even intervals, and
 * within an artist its albums are dealt out the same way.
 *
 * A group of n items gets the positions (i + offset + jitter) / n: one random
 * offset per group decides where its run starts, and a small jitter per item
 * keeps the pattern from looking mechanical without reordering the group.
 * Sorting all positions merges the groups. Items without keys form groups of
 * one, so a list without metadata still comes out in uniform random order.
 */

export type ShuffleGroupKeys = {
  /** Outer spreading key, e.g. the artist. */
  primary: string;
  /** Inner spreading key within one primary group, e.g. the album. */
  secondary: string;
};

type Random = () => number;

export type SpreadShuffleOptions = {
  random?: Random;
  /**
   * Keys of the item that will sit directly before the result (the track that
   * keeps playing while the rest of the queue is mixed). The result avoids
   * opening with the same primary key.
   */
  leading?: ShuffleGroupKeys | null;
};

/**
 * Total jitter span per item, as a fraction of one slot. Two neighbours of a
 * group are one slot apart, so a span below 1 can never swap them.
 */
const JITTER = 0.2;

function fisherYates<T>(items: T[], random: Random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function deal<T>(groups: readonly T[][], random: Random): T[] {
  const placed: { pos: number; item: T }[] = [];
  for (const group of groups) {
    const offset = random();
    group.forEach((item, i) => {
      const jitter = (random() - 0.5) * JITTER;
      placed.push({ pos: (i + offset + jitter) / group.length, item });
    });
  }
  placed.sort((a, b) => a.pos - b.pos);
  return placed.map(p => p.item);
}

/**
 * If the result would open with the leading item's primary key, swap the
 * first item with the earliest one that can take its place without putting
 * two equal keys next to each other anywhere else.
 */
function avoidLeadingRepeat<T>(
  order: T[],
  keysOf: (item: T) => ShuffleGroupKeys | null,
  leading: string,
): void {
  if (order.length < 2) return;
  const primaries = order.map(item => keysOf(item)?.primary ?? null);
  if (primaries[0] !== leading) return;
  const clash = (a: string | null, b: string | null) => a !== null && a === b;
  for (let j = 1; j < order.length; j++) {
    const candidate = primaries[j];
    if (candidate === leading) continue;
    const nextToFront = j === 1 ? primaries[0] : primaries[1];
    const beforeSlot = j === 1 ? candidate : primaries[j - 1];
    const afterSlot = primaries[j + 1] ?? null;
    if (clash(candidate, nextToFront) || clash(leading, beforeSlot) || clash(leading, afterSlot)) continue;
    [order[0], order[j]] = [order[j], order[0]];
    return;
  }
}

export function spreadShuffle<T>(
  items: readonly T[],
  keysOf: (item: T) => ShuffleGroupKeys | null,
  options: SpreadShuffleOptions = {},
): T[] {
  const random = options.random ?? Math.random;
  const byPrimary = new Map<string, { item: T; secondary: string }[]>();
  const groups: T[][] = [];
  for (const item of items) {
    const keys = keysOf(item);
    if (!keys) {
      groups.push([item]);
      continue;
    }
    const entry = { item, secondary: keys.secondary };
    const list = byPrimary.get(keys.primary);
    if (list) list.push(entry);
    else byPrimary.set(keys.primary, [entry]);
  }

  for (const entries of byPrimary.values()) {
    const bySecondary = new Map<string, T[]>();
    for (const { item, secondary } of entries) {
      const list = bySecondary.get(secondary);
      if (list) list.push(item);
      else bySecondary.set(secondary, [item]);
    }
    const inner = [...bySecondary.values()].map(group => fisherYates(group, random));
    groups.push(deal(inner, random));
  }

  const order = deal(groups, random);
  if (options.leading) avoidLeadingRepeat(order, keysOf, options.leading.primary);
  return order;
}
