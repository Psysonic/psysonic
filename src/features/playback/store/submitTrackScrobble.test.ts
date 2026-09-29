import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/helpers/factories';

const scrobbleSong = vi.hoisted(() => vi.fn(async () => null as unknown));
const dispatchScrobble = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@/lib/api/subsonicScrobble', () => ({
  scrobbleSong,
}));

vi.mock('@/music-network', () => ({
  getMusicNetworkRuntimeOrNull: () => ({ dispatchScrobble }),
}));

vi.mock('@/features/playback/utils/playback/playbackServer', () => ({
  playbackProfileIdForTrack: (track: { serverId?: string }, ref?: { serverId?: string }) =>
    ref?.serverId ?? track.serverId ?? '',
}));

import { submitTrackScrobble } from './submitTrackScrobble';
import { usePlayerStore } from './playerStore';

beforeEach(() => {
  scrobbleSong.mockClear();
  scrobbleSong.mockResolvedValue(null);
  dispatchScrobble.mockClear();
  usePlayerStore.setState({ playStatsOverrides: {} });
});

describe('submitTrackScrobble', () => {
  it('sends the play to the owning server and Music Network', () => {
    const track = makeTrack({ id: 't1', title: 'Song', artist: 'A', album: 'B', duration: 200, serverId: 'srv-a' });
    submitTrackScrobble(track, 'srv-queue', 1234);

    expect(scrobbleSong).toHaveBeenCalledWith('t1', 1234, 'srv-queue');
    expect(dispatchScrobble).toHaveBeenCalledWith({
      title: 'Song',
      artist: 'A',
      album: 'B',
      duration: 200,
      timestamp: 1234,
    });
  });

  it('shows the play on rows that are already on screen before the server answers', () => {
    const track = makeTrack({ id: 't1', serverId: 'srv-a' });
    submitTrackScrobble(track, 'srv-queue', 1234);

    const overrides = usePlayerStore.getState().playStatsOverrides;
    expect(overrides['srv-queue:t1']?.played).toBe(new Date(1234).toISOString());
    // Rows without an owner stamp look the track up by its bare id.
    expect(overrides.t1?.played).toBe(new Date(1234).toISOString());
    // The count is the server's, so nothing is guessed for it here.
    expect(overrides['srv-queue:t1']?.playCount).toBeUndefined();
  });

  it('takes the count the server reports without dropping the timestamp', async () => {
    scrobbleSong.mockResolvedValue({ playCount: 7, played: '2026-09-10T12:00:00.000Z' });
    const track = makeTrack({ id: 't1', serverId: 'srv-a' });

    submitTrackScrobble(track, 'srv-queue', 1234);
    await vi.waitFor(() => {
      expect(usePlayerStore.getState().playStatsOverrides['srv-queue:t1']?.playCount).toBe(7);
    });

    expect(usePlayerStore.getState().playStatsOverrides['srv-queue:t1']?.played)
      .toBe('2026-09-10T12:00:00.000Z');
  });

  it('keeps the local timestamp when the server reports no statistics', async () => {
    const track = makeTrack({ id: 't1', serverId: 'srv-a' });
    submitTrackScrobble(track, 'srv-queue', 1234);
    await Promise.resolve();

    expect(usePlayerStore.getState().playStatsOverrides['srv-queue:t1']).toEqual({
      played: new Date(1234).toISOString(),
    });
  });
});
