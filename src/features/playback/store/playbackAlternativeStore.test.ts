import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  resolveSources: vi.fn(),
}));

vi.mock('@/lib/api/library', () => ({
  libraryResolveEntitySources: mocks.resolveSources,
}));

import {
  _resetPlaybackAlternativeStoreForTest,
  clearUnavailablePlaybackFailures,
  recordUnavailablePlaybackFailure,
  reportPlaybackSourceFailure,
  usePlaybackAlternativeStore,
} from './playbackAlternativeStore';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { makeServer, makeTrack } from '@/test/helpers/factories';
import { useAuthStore } from '@/store/authStore';

const source = (serverId: string, id: string) => ({
  serverId,
  id,
  libraryId: '',
  priority: 0,
  durationSec: 180,
  suffix: 'flac',
  bitRate: 1_000,
  sizeBytes: 30_000_000,
  starredAt: null,
  userRating: null,
});

beforeEach(() => {
  resetAuthStore();
  _resetPlaybackAlternativeStoreForTest();
  Object.values(mocks).forEach(mock => mock.mockReset());
});

describe('reportPlaybackSourceFailure', () => {
  it('deduplicates one play generation and filters out the failed concrete source', async () => {
    const serverA = makeServer({ id: 'srv-a', name: 'Alpha', url: 'https://a.test' });
    const serverB = makeServer({ id: 'srv-b', name: 'Beta', url: 'https://b.test' });
    const serverC = makeServer({ id: 'srv-c', name: 'Gamma', url: 'https://c.test' });
    useAuthStore.setState({
      servers: [serverA, serverB, serverC],
      activeServerId: serverA.id,
      libraryBrowseServerIds: [serverA.id, serverB.id, serverC.id],
      libraryBrowseSelectionByServer: {
        [serverA.id]: ['lib-a'],
        [serverB.id]: [],
        [serverC.id]: ['lib-c'],
      },
    });
    mocks.resolveSources.mockResolvedValue([
      source(serverA.id, 'failed'),
      source(serverB.id, 'remote-copy'),
      source(serverC.id, 'unreachable-copy'),
      source(serverC.id, 'local-copy'),
    ]);
    const failedTrack = makeTrack({ id: 'failed', serverId: serverA.id });
    const args = {
      generation: 4,
      queueIndex: 0,
      queueItems: [{ serverId: 'a.test', trackId: 'failed' }],
      track: failedTrack,
      detail: 'decode error',
    };

    reportPlaybackSourceFailure(args);
    reportPlaybackSourceFailure(args);

    await waitFor(() => expect(usePlaybackAlternativeStore.getState().status).toBe('ready'));
    expect(mocks.resolveSources).toHaveBeenCalledOnce();
    expect(mocks.resolveSources).toHaveBeenCalledWith('a.test', {
      entityType: 'track',
      anchorServerId: 'a.test',
      anchorId: 'failed',
      scopes: [
        { serverId: serverA.id, libraryId: 'lib-a' },
        { serverId: serverB.id, libraryId: null },
        { serverId: serverC.id, libraryId: 'lib-c' },
      ],
    });
    expect(usePlaybackAlternativeStore.getState().sources.map(candidate => candidate.id)).toEqual([
      'remote-copy',
      'unreachable-copy',
      'local-copy',
    ]);
  });

  it('allows the same frozen ref to report again in a new play generation', async () => {
    mocks.resolveSources.mockResolvedValue([]);
    const track = makeTrack({ id: 'failed', serverId: 'srv-a' });
    const base = {
      queueIndex: 0,
      queueItems: [{ serverId: 'srv-a', trackId: 'failed' }],
      track,
      detail: 'decode error',
    };

    reportPlaybackSourceFailure({ ...base, generation: 1 });
    await waitFor(() => expect(usePlaybackAlternativeStore.getState().status).toBe('ready'));
    reportPlaybackSourceFailure({ ...base, generation: 2 });
    await waitFor(() => expect(mocks.resolveSources).toHaveBeenCalledTimes(2));

    expect(usePlaybackAlternativeStore.getState().failure?.generation).toBe(2);
  });

  it('reports unavailable only when no alternative source remains', async () => {
    const unavailable = vi.fn();
    mocks.resolveSources.mockResolvedValue([]);

    reportPlaybackSourceFailure({
      generation: 1,
      queueIndex: 0,
      queueItems: [{ serverId: 'srv-a', trackId: 'failed' }],
      track: makeTrack({ id: 'failed', serverId: 'srv-a' }),
      detail: 'decode error',
    }, unavailable);

    await waitFor(() => expect(usePlaybackAlternativeStore.getState().status).toBe('ready'));
    expect(unavailable).toHaveBeenCalledOnce();
  });

  it('keeps the failed slot selected when an alternative exists', async () => {
    const unavailable = vi.fn();
    mocks.resolveSources.mockResolvedValue([source('srv-b', 'copy')]);

    reportPlaybackSourceFailure({
      generation: 1,
      queueIndex: 0,
      queueItems: [{ serverId: 'srv-a', trackId: 'failed' }],
      track: makeTrack({ id: 'failed', serverId: 'srv-a' }),
      detail: 'decode error',
    }, unavailable);

    await waitFor(() => expect(usePlaybackAlternativeStore.getState().status).toBe('ready'));
    expect(unavailable).not.toHaveBeenCalled();
  });
});

describe('unavailable playback failure cycle', () => {
  it('stops after every concrete queue slot failed once, including duplicate tracks', () => {
    const queue = [
      { serverId: 'srv-a', trackId: 'same' },
      { serverId: 'srv-a', trackId: 'same' },
    ];

    expect(recordUnavailablePlaybackFailure(queue, 0)).toBe(false);
    expect(recordUnavailablePlaybackFailure(queue, 1)).toBe(true);
  });

  it('resets after playback succeeds', () => {
    const queue = [
      { serverId: 'srv-a', trackId: 'one' },
      { serverId: 'srv-a', trackId: 'two' },
    ];

    expect(recordUnavailablePlaybackFailure(queue, 0)).toBe(false);
    clearUnavailablePlaybackFailures();
    expect(recordUnavailablePlaybackFailure(queue, 1)).toBe(false);
  });
});
