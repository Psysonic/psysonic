import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore, resetPlayerStore } from '@/test/helpers/storeReset';
import { makeSubsonicSong } from '@/test/helpers/factories';
import type { SubsonicAlbum, SubsonicArtist, SubsonicSong, InternetRadioStation } from '@/lib/api/subsonicTypes';
import type { TopFavoriteArtist } from '@/features/favorites/components/TopFavoriteArtists';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';

const mocks = vi.hoisted(() => ({
  data: {} as {
    albums: SubsonicAlbum[];
    artists: SubsonicArtist[];
    songs: SubsonicSong[];
    radioStations: InternetRadioStation[];
    topFavoriteArtists: TopFavoriteArtist[];
  },
  isMobile: false,
  tracklistCols: [] as string[][],
  visibleSongTitles: [] as string[][],
}));

vi.mock('@/features/favorites/hooks/useFavoritesData', () => ({
  useFavoritesData: () => ({
    ...mocks.data,
    setSongs: vi.fn(),
    setRadioStations: vi.fn(),
    loading: false,
    unfavoriteStation: vi.fn(),
  }),
}));
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.isMobile }));
vi.mock('@/lib/hooks/useResolvedTracklistBpm', () => ({
  useResolvedTracklistBpm: (songs: SubsonicSong[]) => songs,
}));
vi.mock('@/features/favorites/components/FavoritesOfflineHeader', () => ({ default: () => null }));
vi.mock('@/features/artist', () => ({
  ArtistRow: ({ title, artists, hideTitle, onTitleClick }: {
    title: string;
    artists: SubsonicArtist[];
    hideTitle?: boolean;
    onTitleClick?: () => void;
  }) => (
    <section data-testid="fav-section" data-section="artists" data-items={artists.map(a => a.name).join('|')}>
      {!hideTitle && (onTitleClick ? <button type="button" onClick={onTitleClick}>{title}</button> : title)}
    </section>
  ),
  openFavoriteArtists: vi.fn(),
}));
vi.mock('@/features/album', () => ({
  AlbumRow: ({ title, albums, hideTitle, onTitleClick }: {
    title: string;
    albums: SubsonicAlbum[];
    hideTitle?: boolean;
    onTitleClick?: () => void;
  }) => (
    <section data-testid="fav-section" data-section="albums" data-items={albums.map(a => a.name).join('|')}>
      {!hideTitle && (onTitleClick ? <button type="button" onClick={onTitleClick}>{title}</button> : title)}
    </section>
  ),
  openFavoriteAlbums: vi.fn(),
}));
vi.mock('@/features/favorites/components/RadioFavorites', () => ({
  RadioStationRow: ({ title, stations, hideTitle }: {
    title: string;
    stations: InternetRadioStation[];
    hideTitle?: boolean;
  }) => (
    <section data-testid="fav-section" data-section="stations" data-items={stations.map(s => s.name).join('|')}>
      {!hideTitle && title}
    </section>
  ),
}));
vi.mock('@/features/favorites/components/TopFavoriteArtists', () => ({
  TopFavoriteArtistsRow: ({ title, artists, hideTitle }: {
    title: string;
    artists: TopFavoriteArtist[];
    hideTitle?: boolean;
  }) => (
    <section data-testid="fav-section" data-section="topArtists" data-items={artists.map(a => a.name).join('|')}>
      {!hideTitle && title}
    </section>
  ),
}));
vi.mock('@/features/favorites/components/FavoritesSongsSectionHeader', () => ({
  default: ({ titleCount }: { titleCount?: number }) => (
    <h2 data-testid="fav-section">Songs{titleCount == null ? '' : ` (${titleCount})`}</h2>
  ),
}));
vi.mock('@/features/favorites/components/FavoritesSongsTracklist', () => ({
  default: ({ visibleCols, visibleSongs }: { visibleCols: ColDef[]; visibleSongs: SubsonicSong[] }) => {
    mocks.tracklistCols.push(visibleCols.map(c => c.key));
    mocks.visibleSongTitles.push(visibleSongs.map(song => song.title));
    return null;
  },
}));

import Favorites from './Favorites';
import { DEFAULT_FAVORITES_SECTIONS, useFavoritesLayoutStore } from '@/features/favorites/store/favoritesLayoutStore';
import { useLiveSearchScopeStore } from '@/store/liveSearchScopeStore';

function sectionTitles(): string[] {
  return screen.getAllByTestId('fav-section').map(el => el.textContent ?? '');
}

function lastTracklistCols(): string[] {
  return mocks.tracklistCols[mocks.tracklistCols.length - 1] ?? [];
}

function section(id: string): HTMLElement {
  return document.querySelector(`[data-section="${id}"]`) as HTMLElement;
}

function querySection(id: string): HTMLElement | null {
  return document.querySelector(`[data-section="${id}"]`);
}

describe('Favorites page layout', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthStore();
    resetPlayerStore();
    mocks.isMobile = false;
    mocks.tracklistCols = [];
    mocks.visibleSongTitles = [];
    useFavoritesLayoutStore.setState({ sections: DEFAULT_FAVORITES_SECTIONS });
    useLiveSearchScopeStore.setState({ query: '', scope: null, undoStack: [] });
    mocks.data = {
      albums: [{ id: 'al-1', name: 'Album' } as SubsonicAlbum],
      artists: [{ id: 'ar-1', name: 'Artist' } as SubsonicArtist],
      songs: [makeSubsonicSong(), makeSubsonicSong()],
      radioStations: [{ id: 'st-1', name: 'Station', streamUrl: 'https://radio.test/live' }],
      topFavoriteArtists: [
        { id: 'a', name: 'A', count: 3, coverArtId: 'a' },
        { id: 'b', name: 'B', count: 2, coverArtId: 'b' },
      ],
    };
  });

  it('shows every section in the historical order by default', () => {
    renderWithProviders(<Favorites />);

    expect(sectionTitles()).toEqual([
      'Artists', 'Albums', 'Radio Stations', 'Top Artists by Favorites', 'Songs',
    ]);
  });

  it('follows the configured order and leaves hidden sections out', () => {
    useFavoritesLayoutStore.setState({
      sections: [
        { id: 'songs', visible: true },
        { id: 'albums', visible: true },
        { id: 'topArtists', visible: false },
        { id: 'artists', visible: true },
        { id: 'stations', visible: false },
      ],
    });

    renderWithProviders(<Favorites />);

    expect(sectionTitles()).toEqual(['Songs', 'Albums', 'Artists']);
  });

  it('skips a visible section that has nothing to show', () => {
    mocks.data.topFavoriteArtists = [{ id: 'a', name: 'A', count: 3, coverArtId: 'a' }];
    mocks.data.radioStations = [];

    renderWithProviders(<Favorites />);

    expect(sectionTitles()).toEqual(['Artists', 'Albums', 'Songs']);
  });

  it('keeps the number column hidden once it is switched off in the column picker', () => {
    localStorage.setItem('psysonic_favorites_columns', JSON.stringify({
      visible: ['title', 'artist', 'remove'],
      widths: {},
    }));

    renderWithProviders(<Favorites />);

    expect(lastTracklistCols()).toEqual(['title', 'artist', 'remove']);
  });

  it('puts the number cell back in the compact layout, which places cells by position', () => {
    mocks.isMobile = true;
    localStorage.setItem('psysonic_favorites_columns', JSON.stringify({
      visible: ['title', 'artist', 'remove'],
      widths: {},
    }));

    renderWithProviders(<Favorites />);

    expect(lastTracklistCols()).toEqual(['num', 'title', 'artist', 'remove']);
  });

  it('filters every section and auto-collapses non-track rows', () => {
    mocks.data = {
      albums: [
        { id: 'al-blue', name: 'Blue Album', artist: 'Blue Artist' } as SubsonicAlbum,
        { id: 'al-red', name: 'Red Album', artist: 'Red Artist' } as SubsonicAlbum,
      ],
      artists: [
        { id: 'ar-blue', name: 'Blue Artist' } as SubsonicArtist,
        { id: 'ar-red', name: 'Red Artist' } as SubsonicArtist,
      ],
      songs: [
        makeSubsonicSong({ title: 'Blue Song', artist: 'Blue Artist' }),
        makeSubsonicSong({ title: 'Red Song', artist: 'Red Artist' }),
      ],
      radioStations: [
        { id: 'st-blue', name: 'Blue Radio', streamUrl: 'https://radio.test/blue' },
        { id: 'st-red', name: 'Red Radio', streamUrl: 'https://radio.test/red' },
      ],
      topFavoriteArtists: [
        { id: 'top-blue', name: 'Blue Artist', count: 3, coverArtId: 'blue' },
        { id: 'top-red', name: 'Red Artist', count: 2, coverArtId: 'red' },
      ],
    };
    useLiveSearchScopeStore.setState({ query: 'blue', scope: 'favorites', undoStack: [] });

    renderWithProviders(<Favorites />);

    const categoryGroup = screen.getByRole('group', { name: 'Search favorites…' });
    for (const label of ['Artists', 'Albums', 'Radio Stations', 'Top Artists by Favorites']) {
      expect(within(categoryGroup).getByRole('button', { name: `${label} (1)` })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(querySection('artists')).toBeNull();
    expect(querySection('albums')).toBeNull();
    expect(mocks.visibleSongTitles[mocks.visibleSongTitles.length - 1]).toEqual(['Blue Song']);
    expect(sectionTitles()).toContain('Songs (1)');
  });

  it('keeps zero-match categories visible with their result count', () => {
    useLiveSearchScopeStore.setState({ query: 'song', scope: 'favorites', undoStack: [] });

    renderWithProviders(<Favorites />);

    const categoryGroup = screen.getByRole('group', { name: 'Search favorites…' });
    for (const label of ['Artists', 'Albums', 'Radio Stations', 'Top Artists by Favorites']) {
      expect(within(categoryGroup).getByRole('button', { name: `${label} (0)` })).toBeDisabled();
    }
  });

  it('keeps a manually expanded searched section open as the query changes', async () => {
    const user = userEvent.setup();
    mocks.data.albums = [
      { id: 'al-blue', name: 'Blue Album' } as SubsonicAlbum,
      { id: 'al-night', name: 'Night Album' } as SubsonicAlbum,
    ];
    useLiveSearchScopeStore.setState({ query: 'blue', scope: 'favorites', undoStack: [] });
    renderWithProviders(<Favorites />);

    const albumsToggle = screen.getByRole('button', { name: 'Albums (1)' });
    expect(albumsToggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(albumsToggle);
    expect(section('albums')).toHaveAttribute('data-items', 'Blue Album');
    expect(albumsToggle).toHaveAttribute('aria-expanded', 'true');

    act(() => useLiveSearchScopeStore.setState({ query: 'night' }));

    expect(section('albums')).toHaveAttribute('data-items', 'Night Album');
  });

  it('shows at most one searched category rail and collapses the selected one', async () => {
    const user = userEvent.setup();
    useLiveSearchScopeStore.setState({ query: 'a', scope: 'favorites', undoStack: [] });
    renderWithProviders(<Favorites />);

    await user.click(screen.getByRole('button', { name: 'Artists (1)' }));
    expect(section('artists')).toBeInTheDocument();
    expect(querySection('albums')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Albums (1)' }));
    expect(querySection('artists')).toBeNull();
    expect(section('albums')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Albums (1)' }));
    expect(querySection('albums')).toBeNull();
    expect(screen.getByRole('button', { name: 'Albums (1)' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts a new auto-collapse session after the query is cleared', async () => {
    const user = userEvent.setup();
    mocks.data.albums = [{ id: 'al-blue', name: 'Blue Album' } as SubsonicAlbum];
    useLiveSearchScopeStore.setState({ query: 'blue', scope: 'favorites', undoStack: [] });
    renderWithProviders(<Favorites />);

    await user.click(screen.getByRole('button', { name: 'Albums (1)' }));
    expect(section('albums')).toBeInTheDocument();

    act(() => useLiveSearchScopeStore.setState({ query: '' }));
    act(() => useLiveSearchScopeStore.setState({ query: 'blue' }));

    expect(querySection('albums')).toBeNull();
    expect(screen.getByRole('button', { name: 'Albums (1)' })).toHaveAttribute('aria-expanded', 'false');
  });
});
