import { describe, it, expect } from 'vitest';
import { externalSourcesSwitchedOff, resolveCoverSource, type CoverSourcePref } from './coverSources';

const chain = (apple: boolean, lastfm: boolean, server = true): CoverSourcePref[] => [
  { source: 'server', enabled: server },
  { source: 'apple', enabled: apple },
  { source: 'lastfm', enabled: lastfm },
];

describe('externalSourcesSwitchedOff', () => {
  it('names each external source that went from on to off', () => {
    expect(externalSourcesSwitchedOff(chain(true, true), chain(false, true))).toEqual(['apple']);
    expect(externalSourcesSwitchedOff(chain(true, true), chain(true, false))).toEqual(['lastfm']);
    expect(externalSourcesSwitchedOff(chain(true, true), chain(false, false))).toEqual(['apple', 'lastfm']);
  });

  it('ignores switching on, the server row, and reordering', () => {
    expect(externalSourcesSwitchedOff(chain(false, false), chain(true, true))).toEqual([]);
    expect(externalSourcesSwitchedOff(chain(true, true), chain(true, true, false))).toEqual([]);
    const reordered = [...chain(true, true)].reverse();
    expect(externalSourcesSwitchedOff(chain(true, true), reordered)).toEqual([]);
  });

  it('treats a source missing from the new chain as switched off', () => {
    expect(externalSourcesSwitchedOff(chain(true, false), chain(true, false).slice(0, 1))).toEqual(['apple']);
  });
});

describe('resolveCoverSource', () => {
  it('returns the first resolved src', () => {
    expect(resolveCoverSource([{ src: '', pending: false }, { src: 'https://a/img.jpg' }]))
      .toBe('https://a/img.jpg');
  });
  it('holds on a pending candidate instead of flashing a lower one', () => {
    expect(resolveCoverSource([{ src: 'https://a/img.jpg' }, { src: '', pending: true }]))
      .toBe('https://a/img.jpg');
    expect(resolveCoverSource([{ src: '', pending: true }, { src: 'https://b/x.jpg' }]))
      .toBeNull();
  });
  it('steps past a confirmed miss', () => {
    expect(resolveCoverSource([{ src: '', pending: false }, { src: 'https://c/x.jpg' }]))
      .toBe('https://c/x.jpg');
  });
  it('returns null when nothing resolves', () => {
    expect(resolveCoverSource([{ src: '', pending: false }])).toBeNull();
    expect(resolveCoverSource([])).toBeNull();
  });
});
