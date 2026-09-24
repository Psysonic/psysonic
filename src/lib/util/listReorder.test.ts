import { describe, expect, it } from 'vitest';
import { applyListReorderById, moveBlockToGap } from '@/lib/util/listReorder';

type Item = { id: string; visible?: boolean };

const list = (...ids: string[]): Item[] => ids.map(id => ({ id }));
const ids = (items: Item[] | null): string[] | null => items && items.map(i => i.id);

describe('applyListReorderById', () => {
  const base = list('a', 'b', 'c', 'd', 'e');

  it('moves an item to before the target', () => {
    expect(ids(applyListReorderById(base, 'd', { id: 'b', before: true })))
      .toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('moves an item to after the target', () => {
    expect(ids(applyListReorderById(base, 'a', { id: 'c', before: false })))
      .toEqual(['b', 'c', 'a', 'd', 'e']);
  });

  it('moves an item upward', () => {
    expect(ids(applyListReorderById(base, 'e', { id: 'a', before: true })))
      .toEqual(['e', 'a', 'b', 'c', 'd']);
  });

  it('keeps unrelated items (incl. hidden ones) in place', () => {
    // 'x' stands in for a hidden/gated row that is never an anchor.
    const withHidden = list('a', 'x', 'b', 'c');
    expect(ids(applyListReorderById(withHidden, 'c', { id: 'a', before: false })))
      .toEqual(['a', 'c', 'x', 'b']);
  });

  it('returns null when dropping onto itself', () => {
    expect(applyListReorderById(base, 'b', { id: 'b', before: true })).toBeNull();
  });

  it('returns null on a no-op edge (already adjacent)', () => {
    // 'a' before 'b' — a is already right before b → no change.
    expect(applyListReorderById(base, 'a', { id: 'b', before: true })).toBeNull();
    // 'b' after 'a' — same position → no change.
    expect(applyListReorderById(base, 'b', { id: 'a', before: false })).toBeNull();
  });

  it('returns null for an unknown dragged id (defensive guard)', () => {
    expect(applyListReorderById(base, 'nope', { id: 'b', before: true })).toBeNull();
  });

  it('returns null for an unknown target id (defensive guard)', () => {
    expect(applyListReorderById(base, 'a', { id: 'nope', before: true })).toBeNull();
  });

  it('does not mutate the input array', () => {
    const snapshot = ids(base);
    applyListReorderById(base, 'a', { id: 'e', before: false });
    expect(ids(base)).toEqual(snapshot);
  });
});

describe('moveBlockToGap', () => {
  const letters = ['a', 'b', 'c', 'd', 'e'];

  it('moves a scattered block up to the gap, keeping its order', () => {
    expect(moveBlockToGap(letters, [3, 1], 0)).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('moves a block down; the gap counts positions before the move', () => {
    expect(moveBlockToGap(letters, [0, 1], 4)).toEqual(['c', 'd', 'a', 'b', 'e']);
  });

  it('returns null when nothing moves or no index is valid', () => {
    expect(moveBlockToGap(letters, [1, 2], 2)).toBeNull();
    expect(moveBlockToGap(letters, [1], 1)).toBeNull();
    expect(moveBlockToGap(letters, [9, -1, 0.5], 0)).toBeNull();
  });

  it('keeps duplicate-looking entries apart by reference', () => {
    const x1 = { id: 'x' };
    const x2 = { id: 'x' };
    const next = moveBlockToGap([x1, { id: 'y' }, x2], [2], 0);
    expect(next?.[0]).toBe(x2);
    expect(next?.[1]).toBe(x1);
  });
});
