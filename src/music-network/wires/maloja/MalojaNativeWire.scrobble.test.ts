import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { malojaNativeWire } from './MalojaNativeWire';
import type { WireContext } from '../../contracts/ScrobbleWire';
import type { PersistedAccount } from '../../core/accounts';

const invokeMock = vi.mocked(invoke);

function ctx(): WireContext {
  return {
    account: { id: 'mlj1', presetId: 'maloja_native', wireId: 'maloja_native' } as PersistedAccount,
    baseUrl: 'https://maloja.example',
    profileBase: '',
    apiKey: '',
    apiSecret: '',
    sessionKey: 'key',
    username: '',
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({});
});

describe('MalojaNativeWire — artist credit preservation', () => {
  it('keeps the full event.artist on scrobble even when artists[] is present', async () => {
    await malojaNativeWire.scrobble(ctx(), {
      title: 'Collab',
      artist: 'Alice feat. Bob',
      artists: ['Alice', 'Bob'],
      album: 'Album',
      duration: 180,
      timestamp: 1_700_000_000_000,
    });

    const arg = invokeMock.mock.calls[0]?.[1] as {
      jsonBody: { artists: string[] };
    };
    expect(arg.jsonBody.artists).toEqual(['Alice feat. Bob']);
  });
});
