// Characterizes the on-the-wire request shape for scrobble / now-playing.
//
// `track.scrobble` must use the indexed batch/array form (`artist[0]`, `track[0]`,
// …) — Last.fm/Libre.fm accept the bare single form too, but Rocksky rejects it
// (server 500). Durations are rounded to whole seconds; the millisecond timestamp
// is floored to Unix seconds. now-playing keeps the single (non-indexed) form.
// Both calls must be signed (api_sig) and POSTed (get=false). This pins the body
// so a future refactor can't silently regress Rocksky.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { audioscrobblerWire } from './AudioscrobblerWire';
import type { WireContext } from '../../contracts/ScrobbleWire';
import type { PersistedAccount } from '../../core/accounts';

const invokeMock = vi.mocked(invoke);

function ctx(): WireContext {
  return {
    account: { id: 'a1', presetId: 'lastfm', wireId: 'audioscrobbler_v2' } as PersistedAccount,
    baseUrl: 'https://ws.audioscrobbler.com/2.0',
    profileBase: 'https://www.last.fm',
    apiKey: 'k',
    apiSecret: 's',
    sessionKey: 'SK',
    username: 'u',
  };
}

function lastCall() {
  const calls = invokeMock.mock.calls;
  return calls[calls.length - 1];
}

/** Pull the params entries out of the most recent invoke call as a plain map. */
function lastParams(): Record<string, string> {
  const arg = lastCall()?.[1] as { params: [string, string][] };
  return Object.fromEntries(arg.params);
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({});
});

describe('scrobble — Audioscrobbler batch/array form', () => {
  it('emits indexed array keys with rounded duration and second-precision timestamp', async () => {
    await audioscrobblerWire.scrobble(ctx(), {
      title: 'Roygbiv',
      artist: 'Boards of Canada',
      album: 'Music Has the Right to Children',
      duration: 137.6,
      timestamp: 1_700_000_000_500,
    });

    expect(lastParams()).toEqual({
      method: 'track.scrobble',
      'track[0]': 'Roygbiv',
      'artist[0]': 'Boards of Canada',
      'album[0]': 'Music Has the Right to Children',
      'duration[0]': '138',
      'timestamp[0]': '1700000000',
      sk: 'SK',
    });
  });

  it('signs the call and POSTs it (sign=true, get=false)', async () => {
    await audioscrobblerWire.scrobble(ctx(), { title: 'T', artist: 'A', album: '', duration: 10, timestamp: 0 });
    const arg = lastCall()?.[1] as { sign: boolean; get: boolean };
    expect(arg.sign).toBe(true);
    expect(arg.get).toBe(false);
  });
});

describe('updateNowPlaying — single (non-indexed) form', () => {
  it('emits bare keys without array indices', async () => {
    await audioscrobblerWire.updateNowPlaying(ctx(), { title: 'T', artist: 'A', album: 'Al', duration: 200.4, timestamp: 0 });
    expect(lastParams()).toEqual({
      method: 'track.updateNowPlaying',
      track: 'T',
      artist: 'A',
      album: 'Al',
      duration: '200',
      sk: 'SK',
    });
  });
});

describe('first-artist normalization for Audioscrobbler v2', () => {
  it('sends only the first structured artist on scrobble and now-playing even with comma-joined display credits', async () => {
    await audioscrobblerWire.scrobble(ctx(), {
      title: 'Collab',
      artist: 'Alice, Bob & Carol',
      artists: ['Alice', 'Bob', 'Carol'],
      album: 'Album',
      duration: 180,
      timestamp: 1_700_000_000_000,
    });
    expect(lastParams()['artist[0]']).toBe('Alice');

    await audioscrobblerWire.updateNowPlaying(ctx(), {
      title: 'Collab',
      artist: 'Alice, Bob & Carol',
      artists: ['Alice', 'Bob', 'Carol'],
      album: 'Album',
      duration: 180,
      timestamp: 1_700_000_000_000,
    });
    expect(lastParams().artist).toBe('Alice');
  });

  it('splits joined display credits on scrobble and now-playing when structured artists are absent', async () => {
    await audioscrobblerWire.scrobble(ctx(), {
      title: 'Collab',
      artist: 'Alice feat. Bob',
      album: 'Album',
      duration: 180,
      timestamp: 1_700_000_000_000,
    });
    expect(lastParams()['artist[0]']).toBe('Alice');

    await audioscrobblerWire.updateNowPlaying(ctx(), {
      title: 'Collab',
      artist: 'Alice ft. Bob',
      album: 'Album',
      duration: 180,
      timestamp: 1_700_000_000_000,
    });
    expect(lastParams().artist).toBe('Alice');
  });

  it('uses the first artist for getTrackLoved, loveTrack, getTrackStats, and buildTrackUrl', async () => {
    invokeMock.mockResolvedValue({ track: { userloved: '1', listeners: '10', playcount: '20' } });

    await audioscrobblerWire.getTrackLoved(ctx(), {
      title: 'Collab',
      artist: 'Alice, Bob',
      artists: ['Alice', 'Bob'],
    });
    expect(lastParams().artist).toBe('Alice');

    await audioscrobblerWire.loveTrack(ctx(), {
      title: 'Collab',
      artist: 'Alice feat. Bob',
    }, true);
    expect(lastParams().artist).toBe('Alice');

    await audioscrobblerWire.getTrackStats(ctx(), {
      title: 'Collab',
      artist: 'Alice • Bob',
    });
    expect(lastParams().artist).toBe('Alice');

    expect(audioscrobblerWire.buildTrackUrl(ctx(), {
      title: 'Collab',
      artist: 'Alice, Bob',
      artists: ['Alice', 'Bob'],
    })).toBe('https://www.last.fm/music/Alice/_/Collab');
  });

  it('keeps single artists containing slashes like AC/DC intact', async () => {
    await audioscrobblerWire.scrobble(ctx(), {
      title: 'Thunderstruck',
      artist: 'AC/DC',
      album: 'The Razors Edge',
      duration: 292,
      timestamp: 1_700_000_000_000,
    });
    expect(lastParams()['artist[0]']).toBe('AC/DC');
    expect(audioscrobblerWire.buildTrackUrl(ctx(), {
      title: 'Thunderstruck',
      artist: 'AC/DC',
    })).toBe('https://www.last.fm/music/AC%2FDC/_/Thunderstruck');
  });
});
