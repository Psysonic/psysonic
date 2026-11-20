import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listenBrainzWire } from './ListenBrainzWire';
import type { WireContext } from '../../contracts/ScrobbleWire';
import type { PersistedAccount } from '../../core/accounts';

const invokeMock = vi.mocked(invoke);

function ctx(): WireContext {
  return {
    account: { id: 'lb1', presetId: 'listenbrainz', wireId: 'listenbrainz' } as PersistedAccount,
    baseUrl: 'https://api.listenbrainz.org',
    profileBase: 'https://listenbrainz.org',
    apiKey: '',
    apiSecret: '',
    sessionKey: 'tok',
    username: 'u',
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({});
});

describe('ListenBrainzWire — artist credit preservation', () => {
  it('keeps the full event.artist on scrobble and updateNowPlaying even when artists[] is present', async () => {
    const event = {
      title: 'Collab',
      artist: 'Alice, Bob & Carol',
      artists: ['Alice', 'Bob', 'Carol'],
      album: 'Album',
      duration: 180,
      timestamp: 1_700_000_000_000,
    };

    await listenBrainzWire.scrobble(ctx(), event);
    const scrobbleArg = invokeMock.mock.calls[0]?.[1] as {
      jsonBody: { payload: Array<{ track_metadata: { artist_name: string } }> };
    };
    expect(scrobbleArg.jsonBody.payload[0]?.track_metadata.artist_name).toBe('Alice, Bob & Carol');

    await listenBrainzWire.updateNowPlaying(ctx(), event);
    const npArg = invokeMock.mock.calls[1]?.[1] as {
      jsonBody: { payload: Array<{ track_metadata: { artist_name: string } }> };
    };
    expect(npArg.jsonBody.payload[0]?.track_metadata.artist_name).toBe('Alice, Bob & Carol');
  });
});
