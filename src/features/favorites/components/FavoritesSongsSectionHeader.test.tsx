import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import type { Track } from '@/lib/media/trackTypes';

vi.mock('@/lib/util/shuffleArray', () => ({
  // Deterministic stand-in: a reversed list is a reordering the test can predict.
  shuffleArray: <T,>(items: T[]) => [...items].reverse(),
}));
vi.mock('@/features/contextMenu/components/ContextMenu', () => ({ AddToPlaylistSubmenu: () => null }));
vi.mock('@/features/playback', () => ({ BulkTrackRating: () => null }));
vi.mock('@/features/offline', () => ({
  useOfflineBrowseContext: () => ({ active: false }),
  offlineActionPolicy: () => ({ canRate: true }),
}));
vi.mock('@/ui/GenreFilterBar', () => ({ default: () => null }));

import FavoritesSongsSectionHeader from './FavoritesSongsSectionHeader';

function renderHeader(songs: SubsonicSong[], selectedIds: ReadonlySet<string> = new Set()) {
  const playTrack = vi.fn();
  const inSelectMode = selectedIds.size > 0;
  renderWithProviders(
    <FavoritesSongsSectionHeader
      visibleSongs={songs}
      songs={songs}
      selectedArtist={null}
      selectedArtistName={null}
      setSelectedArtist={vi.fn()}
      selectedGenres={[]}
      setSelectedGenres={vi.fn()}
      yearRange={[1950, 2026]}
      setYearRange={vi.fn()}
      showFilters={false}
      setShowFilters={vi.fn()}
      setSortKey={vi.fn()}
      setSortClickCount={vi.fn()}
      playTrack={playTrack}
      enqueue={vi.fn()}
      starredOverrides={{}}
      minYear={1950}
      currentYear={2026}
      inSelectMode={inSelectMode}
      selectedCount={selectedIds.size}
      selectedIds={selectedIds}
      showPlPicker={false}
      setShowPlPicker={vi.fn()}
      ratings={{}}
      onRate={vi.fn()}
    />,
  );
  return playTrack;
}

function playedIds(playTrack: ReturnType<typeof vi.fn>): { first: string; queue: string[] } {
  const [first, queue] = playTrack.mock.calls[0] as [Track, Track[]];
  return { first: first.id, queue: queue.map(t => t.id) };
}

describe('FavoritesSongsSectionHeader shuffle', () => {
  beforeEach(() => {
    resetAuthStore();
  });

  it('plays every listed song in shuffled order, starting with the first shuffled one', async () => {
    const songs = [makeSubsonicSong({ id: 's1' }), makeSubsonicSong({ id: 's2' }), makeSubsonicSong({ id: 's3' })];
    const playTrack = renderHeader(songs);

    await userEvent.click(screen.getByRole('button', { name: 'Shuffle all' }));

    expect(playTrack).toHaveBeenCalledTimes(1);
    expect(playedIds(playTrack)).toEqual({ first: 's3', queue: ['s3', 's2', 's1'] });
  });

  it('shuffles only the selected songs while a selection is active', async () => {
    const songs = [makeSubsonicSong({ id: 's1' }), makeSubsonicSong({ id: 's2' }), makeSubsonicSong({ id: 's3' })];
    const playTrack = renderHeader(songs, new Set([ownedEntityKey(songs[0]), ownedEntityKey(songs[2])]));

    await userEvent.click(screen.getByRole('button', { name: 'Shuffle selected' }));

    expect(playedIds(playTrack)).toEqual({ first: 's3', queue: ['s3', 's1'] });
  });

  it('is disabled when there is nothing to play', () => {
    renderHeader([]);

    expect(screen.getByRole('button', { name: 'Shuffle all' })).toBeDisabled();
  });
});
