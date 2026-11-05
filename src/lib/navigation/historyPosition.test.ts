import { describe, expect, it } from 'vitest';
import {
  canGoBack,
  canGoForward,
  INITIAL_HISTORY_POSITION,
  nextHistoryPosition,
  readHistoryIndex,
} from './historyPosition';

describe('readHistoryIndex', () => {
  it('reads the router index from history.state', () => {
    expect(readHistoryIndex({ usr: null, key: 'k', idx: 3 })).toBe(3);
  });

  it('treats a missing or malformed index as the first entry', () => {
    expect(readHistoryIndex(null)).toBe(0);
    expect(readHistoryIndex(undefined)).toBe(0);
    expect(readHistoryIndex({})).toBe(0);
    expect(readHistoryIndex({ idx: '2' })).toBe(0);
    expect(readHistoryIndex({ idx: -1 })).toBe(0);
    expect(readHistoryIndex({ idx: Number.NaN })).toBe(0);
  });
});

describe('nextHistoryPosition', () => {
  it('starts with nothing to go back or forward to', () => {
    expect(canGoBack(INITIAL_HISTORY_POSITION)).toBe(false);
    expect(canGoForward(INITIAL_HISTORY_POSITION)).toBe(false);
  });

  it('allows back after a push, but not forward', () => {
    const p = nextHistoryPosition(INITIAL_HISTORY_POSITION, 'PUSH', 1);
    expect(canGoBack(p)).toBe(true);
    expect(canGoForward(p)).toBe(false);
  });

  it('allows forward after stepping back', () => {
    let p = nextHistoryPosition(INITIAL_HISTORY_POSITION, 'PUSH', 1);
    p = nextHistoryPosition(p, 'PUSH', 2);
    p = nextHistoryPosition(p, 'POP', 1);
    expect(p).toEqual({ index: 1, furthest: 2 });
    expect(canGoBack(p)).toBe(true);
    expect(canGoForward(p)).toBe(true);
  });

  it('drops the forward entries when a new page is pushed after stepping back', () => {
    let p = nextHistoryPosition(INITIAL_HISTORY_POSITION, 'PUSH', 1);
    p = nextHistoryPosition(p, 'PUSH', 2);
    p = nextHistoryPosition(p, 'POP', 0);
    p = nextHistoryPosition(p, 'PUSH', 1);
    expect(p).toEqual({ index: 1, furthest: 1 });
    expect(canGoForward(p)).toBe(false);
  });

  it('keeps the position on a replace', () => {
    let p = nextHistoryPosition(INITIAL_HISTORY_POSITION, 'PUSH', 1);
    p = nextHistoryPosition(p, 'PUSH', 2);
    p = nextHistoryPosition(p, 'POP', 1);
    p = nextHistoryPosition(p, 'REPLACE', 1);
    expect(p).toEqual({ index: 1, furthest: 2 });
  });
});
