import { beforeEach, describe, expect, it, vi } from 'vitest';

const servers = vi.hoisted(() => [] as Array<{ id: string; url: string }>);
const mintedServerProfileIds = vi.hoisted(() => [] as string[]);

vi.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ servers, mintedServerProfileIds }),
  },
}));

import { analysisTrackRef } from '@/features/playback/store/analysisTrackRef';

const MINTED_ID = `${Date.UTC(2026, 3, 15).toString(36)}k2ff7q1zt`;

beforeEach(() => {
  servers.splice(0, servers.length);
  mintedServerProfileIds.splice(0, mintedServerProfileIds.length);
});

describe('analysisTrackRef', () => {
  it('rejects a minted profile id whose server profile is no longer configured', () => {
    // The library keys its rows by address, so an ephemeral profile id reaching
    // enrichment fails the `(server_id, track_id)` foreign key (issue #1434).
    mintedServerProfileIds.push(MINTED_ID);
    expect(analysisTrackRef('track-1', MINTED_ID)).toEqual({
      trackId: 'track-1',
      serverIndexKey: null,
    });
  });

  it('resolves a configured profile id through its primary URL', () => {
    servers.push({ id: MINTED_ID, url: 'https://music.example.test/' });
    mintedServerProfileIds.push(MINTED_ID);
    expect(analysisTrackRef('track-1', MINTED_ID)).toEqual({
      trackId: 'track-1',
      serverIndexKey: 'music.example.test',
    });
  });

  it('keeps the configured index key of a host that looks like a profile id', () => {
    servers.push({ id: 'profile-1', url: 'http://mpserver' });
    expect(analysisTrackRef('track-1', 'mpserver')).toEqual({
      trackId: 'track-1',
      serverIndexKey: 'mpserver',
    });
  });

  it('keeps bare hostnames that were never minted, whatever their shape', () => {
    // `mpserver` is exactly the timestamp width and `mpserver01` carries extra
    // characters; both decode into the minting window, so no prefix rule can
    // separate them from a profile id. Neither was minted, so both must pass —
    // rejecting them is the waveform/loudness loss this boundary must avoid.
    for (const host of ['mpserver', 'mpserver01', 'mpserver1', 'musicbox01']) {
      expect(analysisTrackRef('track-1', host)).toEqual({
        trackId: 'track-1',
        serverIndexKey: host,
      });
    }
  });

  it('keeps an address-derived key after its profile was removed', () => {
    // Removing a profile leaves the library rows in place under the address
    // key, and queue entries keep that key. Only the minted id is refused.
    mintedServerProfileIds.push(MINTED_ID);
    expect(analysisTrackRef('track-1', 'mpserver01')).toEqual({
      trackId: 'track-1',
      serverIndexKey: 'mpserver01',
    });
  });
});
