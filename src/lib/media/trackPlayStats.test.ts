import { describe, expect, it } from 'vitest';
import { trackPlayStats } from './trackPlayStats';

describe('trackPlayStats', () => {
  it('keeps the loaded values when nothing was played this session', () => {
    const track = { id: 'a', serverId: 'srv', playCount: 3, played: '2026-09-01T10:00:00Z' };
    expect(trackPlayStats(track, {})).toEqual({ playCount: 3, played: '2026-09-01T10:00:00Z' });
  });

  it('prefers what this session recorded over the loaded values', () => {
    const track = { id: 'a', serverId: 'srv', playCount: 3, played: '2026-09-01T10:00:00Z' };
    const overrides = { 'srv:a': { playCount: 4, played: '2026-09-10T12:00:00Z' } };
    expect(trackPlayStats(track, overrides)).toEqual({
      playCount: 4,
      played: '2026-09-10T12:00:00Z',
    });
  });

  it('takes the timestamp on its own while the count is still being read back', () => {
    const track = { id: 'a', serverId: 'srv', playCount: 3, played: '2026-09-01T10:00:00Z' };
    const overrides = { 'srv:a': { played: '2026-09-10T12:00:00Z' } };
    expect(trackPlayStats(track, overrides)).toEqual({
      playCount: 3,
      played: '2026-09-10T12:00:00Z',
    });
  });

  it('falls back to the unscoped key for rows that carry no server', () => {
    const track = { id: 'a', playCount: 1 };
    expect(trackPlayStats(track, { a: { playCount: 2 } })).toEqual({
      playCount: 2,
      played: undefined,
    });
  });

  it('leaves a never-played track empty rather than reporting a zero count', () => {
    expect(trackPlayStats({ id: 'a' }, {})).toEqual({ playCount: undefined, played: undefined });
  });
});
