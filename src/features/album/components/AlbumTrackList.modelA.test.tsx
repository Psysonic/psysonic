import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { useAuthStore } from '@/store/authStore';
import { offlineActionPolicy } from '@/features/offline';

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/ui/TracklistColumnPicker', () => ({ TracklistColumnPicker: () => null }));
vi.mock('@/features/album/components/DiscHeaderCover', () => ({ DiscHeaderCover: () => null }));

import AlbumTrackList from './AlbumTrackList';

const SONGS: SubsonicSong[] = [
  { id: 's1', serverId: 'srv', title: 'One', artist: 'A', album: 'Rec', albumId: 'al', duration: 60, track: 1 },
  { id: 's2', serverId: 'srv', title: 'A rather long second title', artist: 'A', album: 'Rec', albumId: 'al', duration: 61, track: 2 },
  { id: 's3', serverId: 'srv', title: 'Three', artist: 'A', album: 'Rec', albumId: 'al', duration: 62, track: 3 },
];

function renderList() {
  return renderWithProviders(
    <AlbumTrackList
      songs={SONGS}
      hasVariousArtists={false}
      currentTrack={null}
      isPlaying={false}
      ratings={{}}
      userRatingOverrides={{}}
      starredSongs={new Set()}
      onPlaySong={vi.fn()}
      onRate={vi.fn()}
      onToggleSongStar={vi.fn()}
      onContextMenu={vi.fn()}
    />,
  );
}

describe('AlbumTrackList — spreadsheet model', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('puts the table into the sideways-scrolling viewport', () => {
    const { container } = renderList();
    expect(container.querySelector('.tl-viewport .tl-head-clip .tl-header')).not.toBeNull();
    expect(container.querySelector('.tl-viewport .tl-body .track-row')).not.toBeNull();
  });

  it('gives every visible column a divider', () => {
    const { container } = renderList();
    const headerCells = container.querySelectorAll('.tl-header .tl-head-cell');
    expect(screen.getAllByRole('separator')).toHaveLength(headerCells.length);
  });

  it('lays every row cell out like its header cell', () => {
    const { container } = renderList();
    const headKeys = [...container.querySelectorAll('.tl-header .tl-head-cell')].map(c => c.getAttribute('data-tl-col'));
    const row = screen.getByText('One').closest('.track-row')!;
    const rowKeys = [...row.children].map(c => c.getAttribute('data-tl-col'));
    expect(rowKeys).toEqual(headKeys);
    expect([...row.children].every(c => c.classList.contains('tl-cell'))).toBe(true);
  });

  it('marks the title and artist text for measuring', () => {
    const { container } = renderList();
    const titleCell = screen.getByText('A rather long second title').closest('.tl-cell');
    expect(titleCell).toHaveAttribute('data-tl-text', 'A rather long second title');
    expect(container.querySelector('.tl-cell[data-tl-col="artist"]')).toHaveAttribute('data-tl-text', 'A');
  });

  it('uses only px widths, the title included', () => {
    const { container } = renderList();
    const template = (container.querySelector('.tl-header') as HTMLElement).style.gridTemplateColumns;
    expect(template).not.toMatch(/fr|minmax/);
    expect(template).toContain('340px');
  });
});

describe('AlbumTrackList — header menu', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens the column menu on a right-click on the header', () => {
    const { container } = renderList();
    const titleHead = container.querySelector('.tl-head-cell[data-tl-col="title"]')!;
    fireEvent.contextMenu(titleHead, { clientX: 100, clientY: 20 });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Genre' })).toBeInTheDocument();
  });
});

describe('AlbumTrackList — header keys and the row cursor', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('closes the header menu with one Escape while a row is highlighted', () => {
    const { container } = renderList();
    fireEvent.click(screen.getByText('One').closest('.track-row')!);
    fireEvent.contextMenu(container.querySelector('.tl-head-cell[data-tl-col="title"]')!, { clientX: 100, clientY: 20 });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not play the highlighted row on Enter in the header', () => {
    const onPlaySong = vi.fn();
    const { container } = renderWithProviders(
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
    fireEvent.click(screen.getByText('One').closest('.track-row')!);
    onPlaySong.mockClear();
    fireEvent.keyDown(container.querySelector('.tl-head-cell[data-tl-col="num"]')!, { key: 'Enter' });
    expect(onPlaySong).not.toHaveBeenCalled();
  });
});

describe('AlbumTrackList — offline grid', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ showStarRatings: true });
  });

  // Offline drops `favorite`, so the list builds its own grid. A column that has
  // no stored width yet (ratings switched on while the album is open) must get
  // its default width there too, not `undefinedpx`.
  it('gives a column without a stored width its default in the offline grid', () => {
    localStorage.setItem('psysonic_tracklist_columns', JSON.stringify({
      v: 2, visible: ['num', 'title', 'rating', 'duration'], widths: {},
    }));
    useAuthStore.setState({ showStarRatings: false });
    const { container } = renderWithProviders(
      <AlbumTrackList
        songs={SONGS}
        hasVariousArtists={false}
        currentTrack={null}
        isPlaying={false}
        ratings={{}}
        userRatingOverrides={{}}
        starredSongs={new Set()}
        onPlaySong={vi.fn()}
        onRate={vi.fn()}
        onToggleSongStar={vi.fn()}
        onContextMenu={vi.fn()}
        actionPolicy={offlineActionPolicy('trackRow', true)}
      />,
    );
    act(() => useAuthStore.setState({ showStarRatings: true }));
    const header = container.querySelector('.tl-header') as HTMLElement;
    const cells = header.querySelectorAll('.tl-head-cell');
    expect([...cells].map(c => c.getAttribute('data-tl-col'))).toEqual(['num', 'title', 'rating', 'duration']);
    expect(header.style.gridTemplateColumns).toBe('60px 340px 120px 92px');
  });
});

describe('AlbumTrackList — alignment', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('centres the metadata columns in header and rows alike', () => {
    const { container } = renderList();
    for (const key of ['duration', 'format', 'genre', 'playCount', 'lastPlayed', 'bpm']) {
      expect(container.querySelector(`.tl-head-cell[data-tl-col="${key}"]`)).toHaveClass('tl-cell--center');
      expect(container.querySelector(`.tl-body .tl-cell[data-tl-col="${key}"]`)).toHaveClass('tl-cell--center');
    }
    expect(container.querySelector('.tl-head-cell[data-tl-col="artist"]')).toHaveClass('tl-cell--start');
  });
});
