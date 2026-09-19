import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
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
  ArtistRow: ({ title }: { title: string }) => <section data-testid="fav-section">{title}</section>,
  openFavoriteArtists: vi.fn(),
}));
vi.mock('@/features/album', () => ({
  AlbumRow: ({ title }: { title: string }) => <section data-testid="fav-section">{title}</section>,
  openFavoriteAlbums: vi.fn(),
}));
vi.mock('@/features/favorites/components/RadioFavorites', () => ({
  RadioStationRow: ({ title }: { title: string }) => <section data-testid="fav-section">{title}</section>,
}));
vi.mock('@/features/favorites/components/TopFavoriteArtists', () => ({
  TopFavoriteArtistsRow: ({ title }: { title: string }) => <section data-testid="fav-section">{title}</section>,
}));
vi.mock('@/features/favorites/components/FavoritesSongsSectionHeader', () => ({
  default: () => <h2 data-testid="fav-section">Songs</h2>,
}));
vi.mock('@/features/favorites/components/FavoritesSongsTracklist', () => ({
  default: ({ visibleCols }: { visibleCols: ColDef[] }) => {
    mocks.tracklistCols.push(visibleCols.map(c => c.key));
    return null;
  },
}));

import Favorites from './Favorites';
import { DEFAULT_FAVORITES_SECTIONS, useFavoritesLayoutStore } from '@/features/favorites/store/favoritesLayoutStore';

function sectionTitles(): string[] {
  return screen.getAllByTestId('fav-section').map(el => el.textContent ?? '');
}

function lastTracklistCols(): string[] {
  return mocks.tracklistCols[mocks.tracklistCols.length - 1] ?? [];
}

describe('Favorites page layout', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthStore();
    resetPlayerStore();
    mocks.isMobile = false;
    mocks.tracklistCols = [];
    useFavoritesLayoutStore.setState({ sections: DEFAULT_FAVORITES_SECTIONS });
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
});
