import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import { makeTrack, seedQueue } from '@/test/helpers/factories';
import { useLiveSearchScopeStore } from '@/store/liveSearchScopeStore';
import { registerOrbitRuntime, type OrbitSnapshot } from '@/store/orbitRuntime';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import MobileSearchOverlay from '@/features/search/components/MobileSearchOverlay';

const mocks = vi.hoisted(() => ({ showToast: vi.fn(), suggestTracks: vi.fn(async () => {}) }));

vi.mock('@/lib/dom/toast', () => ({ showToast: mocks.showToast }));
vi.mock('@/features/search/hooks/useShareSearch', () => ({ useShareSearch: () => ({ shareMatch: null }) }));
vi.mock('@/features/search/hooks/useLiveSearchQuery', () => ({
  useLiveSearchQuery: ({ setResults }: { setResults: (r: unknown) => void }) => {
    useEffect(() => {
      setResults({ artists: [], albums: [], songs: [{ id: 's1', title: 'Song one', artist: 'Artist', serverId: 'srv' }] });
    }, [setResults]);
  },
}));
vi.mock('@/cover/AlbumCoverArtImage', () => ({ AlbumCoverArtImage: () => null }));
vi.mock('@/cover/ArtistCoverArtImage', () => ({ ArtistCoverArtImage: () => null }));
vi.mock('@/cover/CoverArtImage', () => ({ CoverArtImage: () => null }));

let snapshot: OrbitSnapshot;

beforeEach(() => {
  resetAllStores();
  mocks.showToast.mockClear();
  mocks.suggestTracks.mockClear();
  registerOrbitRuntime({
    getSnapshot: () => snapshot,
    bulkGuard: async () => true,
    allowsTrackServer: () => true,
    suggestTracks: mocks.suggestTracks,
  });
  seedQueue([makeTrack({ id: 'playing' })]);
  useLiveSearchScopeStore.setState({ query: 'song', scope: null, undoStack: [] });
});

const addedToQueueToasts = () => mocks.showToast.mock.calls.filter(([text]) => /Song one/.test(String(text)));

describe('MobileSearchOverlay song tap (narrow window)', () => {
  it('an Orbit guest suggests the song to the host without the queue notice', async () => {
    snapshot = { role: 'guest', phase: 'active', state: null, serverId: 'srv' };
    renderWithProviders(<MobileSearchOverlay onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('Song one'));
    expect(mocks.suggestTracks).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().queueItems.map(r => r.trackId)).toEqual(['playing']);
    expect(addedToQueueToasts()).toEqual([]);
  });

  it('without a session the song joins the queue with the queue notice', async () => {
    snapshot = { role: null, phase: 'idle', state: null, serverId: null };
    renderWithProviders(<MobileSearchOverlay onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('Song one'));
    expect(mocks.suggestTracks).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queueItems.map(r => r.trackId)).toEqual(['playing', 's1']);
    expect(addedToQueueToasts()).toHaveLength(1);
  });
});
