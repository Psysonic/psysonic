import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { useThemeStore } from '@/store/themeStore';
import { useSelectionStore } from '@/store/selectionStore';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/ui/TracklistColumnPicker', () => ({ TracklistColumnPicker: () => null }));
vi.mock('@/features/album/components/TracklistHeaderRow', () => ({ TracklistHeaderRow: () => null }));
vi.mock('@/features/album/components/DiscHeaderCover', () => ({ DiscHeaderCover: () => null }));

import AlbumTrackList from './AlbumTrackList';

const SONGS: SubsonicSong[] = [
  { id: 's1', serverId: 'srv', title: 'One', artist: 'A', album: 'Rec', albumId: 'al', duration: 60, track: 1 },
  { id: 's2', serverId: 'srv', title: 'Two', artist: 'A', album: 'Rec', albumId: 'al', duration: 60, track: 2 },
];

function renderList(onPlaySong = vi.fn()) {
  renderWithProviders(
    <AlbumTrackList
      songs={SONGS}
      hasVariousArtists={false}
      currentTrack={null}
      isPlaying={false}
      ratings={{}}
      userRatingOverrides={{}}
      starredSongs={new Set()}
      onPlaySong={onPlaySong}
      onRate={vi.fn()}
      onToggleSongStar={vi.fn()}
      onContextMenu={vi.fn()}
    />,
  );
  const row = (title: string) => screen.getByText(title).closest<HTMLElement>('.track-row')!;
  return { row, onPlaySong };
}

describe('AlbumTrackList cursor', () => {
  afterEach(() => {
    useThemeStore.setState({ trackRowPlayClick: 'single' });
    useSelectionStore.getState().clearAll();
  });

  it('takes the highlighted row into a multi-selection started with Ctrl', () => {
    useThemeStore.setState({ trackRowPlayClick: 'double' });
    const { row } = renderList();
    fireEvent.click(row('One'));
    fireEvent.click(row('Two'), { ctrlKey: true });
    expect([...useSelectionStore.getState().selectedIds].sort())
      .toEqual([ownedEntityKey(SONGS[0]), ownedEntityKey(SONGS[1])].sort());
  });

  it('drops the multi-selection and the highlight with one Escape, in either click mode', () => {
    const { row } = renderList();
    fireEvent.click(row('One'));
    fireEvent.click(row('Two'), { ctrlKey: true });
    expect(useSelectionStore.getState().selectedIds.size).toBe(2);

    const list = document.querySelector<HTMLElement>('[data-track-cursor-list]')!;
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    expect(document.querySelector('.track-row--cursor')).toBeNull();
  });

  it('marks the clicked row in double-click mode and plays it with Enter', () => {
    useThemeStore.setState({ trackRowPlayClick: 'double' });
    const { row, onPlaySong } = renderList();
    fireEvent.click(row('Two'));
    expect(row('Two')).toHaveClass('track-row--cursor');
    const list = document.querySelector<HTMLElement>('[data-track-cursor-list]')!;
    expect(document.activeElement).toBe(list);
    expect(onPlaySong).not.toHaveBeenCalled();

    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onPlaySong).toHaveBeenCalledWith(SONGS[1]);
  });
});
