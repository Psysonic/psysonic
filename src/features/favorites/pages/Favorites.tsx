import { queueSongStar, queueSongRating } from '@/features/playback/store/pendingStarSync';
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTracklistColumns, type ColDef, TRACK_TITLE_FLEX_COL } from '@/lib/hooks/useTracklistColumns';
import { TopFavoriteArtistsRow } from '@/features/favorites/components/TopFavoriteArtists';
import { RadioStationRow } from '@/features/favorites/components/RadioFavorites';
import FavoritesSongsSectionHeader from '@/features/favorites/components/FavoritesSongsSectionHeader';
import FavoritesSongsTracklist from '@/features/favorites/components/FavoritesSongsTracklist';
import { useFavoritesData } from '@/features/favorites/hooks/useFavoritesData';
import { useFavoritesSongFiltering } from '@/features/favorites/hooks/useFavoritesSongFiltering';
import { useFavoritesSelection } from '@/features/favorites/hooks/useFavoritesSelection';
import { useBulkPlPickerOutsideClick } from '@/features/playlist/hooks/useBulkPlPickerOutsideClick';
import { AlbumRow } from '@/features/album';
import { ArtistRow, openFavoriteArtists } from '@/features/artist';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { useTranslation } from 'react-i18next';
import { useSelectionStore } from '@/store/selectionStore';
import FavoritesOfflineHeader from '@/features/favorites/components/FavoritesOfflineHeader';
import {
  emitFavoritesBrowseDebug,
  formatFavoritesBrowseTraceReport,
  getFavoritesBrowseTraceSnapshot,
  subscribeFavoritesBrowseTrace,
} from '@/lib/library/favoritesBrowseDebug';
import { usePsyLabDebugTraces } from '@/lib/perf/psyLabDebugTraces';
import { getLibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import { openFavoriteAlbums } from '@/features/album';
import { useNavigate } from 'react-router';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { sameRadioStation } from '@/features/radio';
import { useResolvedTracklistBpm } from '@/lib/hooks/useResolvedTracklistBpm';
import { useAuthStore } from '@/store/authStore';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useFavoritesLayoutStore, type FavoritesSectionId } from '@/features/favorites/store/favoritesLayoutStore';

const FAV_NUM_COLUMN: ColDef = { key: 'num', i18nKey: 'trackRowNumber', minWidth: 60, defaultWidth: 60, required: false };

const FAV_COLUMNS: readonly ColDef[] = [
  FAV_NUM_COLUMN,
  { key: 'title',      i18nKey: 'trackTitle',      ...TRACK_TITLE_FLEX_COL, required: true },
  { key: 'artist',     i18nKey: 'trackArtist',     minWidth: 80,  defaultWidth: 180, required: false },
  { key: 'album',      i18nKey: 'trackAlbum',      minWidth: 80,  defaultWidth: 180, required: false },
  { key: 'genre',      i18nKey: 'trackGenre',      minWidth: 60,  defaultWidth: 120, required: false },
  { key: 'rating',     i18nKey: 'trackRating',     minWidth: 80,  defaultWidth: 120, required: false },
  { key: 'duration',   i18nKey: 'trackDuration',   minWidth: 72,  defaultWidth: 92,  required: false },
  { key: 'format',     i18nKey: 'trackFormat',     minWidth: 60,  defaultWidth: 80,  required: false },
  { key: 'playCount',  i18nKey: 'trackPlayCount', minWidth: 60,  defaultWidth: 80,  required: false },
  { key: 'lastPlayed', i18nKey: 'trackLastPlayed', minWidth: 90,  defaultWidth: 130, required: false },
  { key: 'bpm',        i18nKey: 'trackBpm',        minWidth: 50,  defaultWidth: 70,  required: false },
  { key: 'remove',     i18nKey: null,              minWidth: 36,  defaultWidth: 36,  required: true  },
];

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1950;

export default function Favorites() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const favoritesBrowseDiagnosticsEnabled = usePsyLabDebugTraces().favoritesBrowse;
  const favoritesTraceEntries = useSyncExternalStore(
    subscribeFavoritesBrowseTrace,
    getFavoritesBrowseTraceSnapshot,
    getFavoritesBrowseTraceSnapshot,
  );
  const {
    albums, artists, songs, setSongs, radioStations,
    loading, topFavoriteArtists, unfavoriteStation,
  } = useFavoritesData();

  // ── Sorting (3-state: asc → desc → reset) ────────────────────────────────
  const [sortKey, setSortKey] = useState<string>('natural');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [sortClickCount, setSortClickCount] = useState(0);

  // ── Artist filtering ─────────────────────────────────────────────────────
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);

  // ── Genre filtering ──────────────────────────────────────────────────────
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

  // ── Year range filtering ─────────────────────────────────────────────────
  const [yearRange, setYearRange] = useState<[number, number]>([MIN_YEAR, CURRENT_YEAR]);
  const [showFilters, setShowFilters] = useState(false);

  // ── Column resize/visibility (must be before early return) ───────────────
  const {
    colVisible, visibleCols, gridStyle,
    startResize, startFlexColumnResize, toggleColumn, resetColumns,
    pickerOpen, setPickerOpen, pickerRef, tracklistRef,
  } = useTracklistColumns(FAV_COLUMNS, 'psysonic_favorites_columns');
  const isMobile = useIsMobile();
  // The compact (<800px) tracklist grid places cells by position and expects
  // the number cell first; without it the title would land in the narrow slot.
  const tracklistCols = useMemo(
    () => (isMobile && !colVisible.has('num') ? [FAV_NUM_COLUMN, ...visibleCols] : visibleCols),
    [isMobile, colVisible, visibleCols],
  );
  const sectionConfig = useFavoritesLayoutStore(s => s.sections);
  const activeServerId = useAuthStore(s => s.activeServerId);
  const resolvedBpmSongs = useResolvedTracklistBpm(
    songs,
    colVisible.has('bpm') || sortKey === 'bpm',
    activeServerId ?? undefined,
  );

  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [showPlPicker, setShowPlPicker] = useState(false);

  const selectedCount = useSelectionStore(s => s.selectedIds.size);
  const selectedIds = useSelectionStore(s => s.selectedIds);
  const inSelectMode = selectedCount > 0;

  const playTrack = usePlayerStore(s => s.playTrack);
  const enqueue = usePlayerStore(s => s.enqueue);
  const playRadio = usePlayerStore(s => s.playRadio);
  const stop = usePlayerStore(s => s.stop);
  const currentRadio = usePlayerStore(s => s.currentRadio);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const starredOverrides = usePlayerStore(s => s.starredOverrides);

  const handleRate = (song: SubsonicSong, rating: number) => {
    const key = ownedEntityKey(song);
    setRatings(r => ({ ...r, [key]: rating }));
    // F4: optimistic override + retried server sync via the central helper.
    queueSongRating(song.id, rating, song.serverId, { scopedOverride: true });
  };

  function removeSong(song: SubsonicSong) {
    // F4: optimistic un-star + retried server sync via the central helper.
    const key = ownedEntityKey(song);
    queueSongStar(song.id, false, song.serverId, { scopedOverride: true });
    setSongs(prev => prev.filter(candidate => ownedEntityKey(candidate) !== key));
  }

  const { visibleSongs, handleSortClick, getSortIndicator } = useFavoritesSongFiltering({
    songs: resolvedBpmSongs,
    sortKey, setSortKey, sortDir, setSortDir, sortClickCount, setSortClickCount,
    selectedArtist, selectedGenres, yearRange, ratings,
  });

  const selectedArtistName = useMemo(
    () => selectedArtist ? topFavoriteArtists.find(a => a.id === selectedArtist)?.name ?? null : null,
    [selectedArtist, topFavoriteArtists],
  );

  const { toggleSelect } = useFavoritesSelection(visibleSongs, inSelectMode, tracklistRef);

  useBulkPlPickerOutsideClick(showPlPicker, setShowPlPicker);

  useEffect(() => {
    // React Compiler set-state-in-effect rule: local state synced with store/prop inputs when the effect’s dependencies change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!inSelectMode) setShowPlPicker(false);
  }, [inSelectMode]);

  useEffect(() => {
    if (loading) return;
    emitFavoritesBrowseDebug('render_ready', {
      albumCount: albums.length,
      artistCount: artists.length,
      songCount: songs.length,
      radioStationCount: radioStations.length,
      visibleSongCount: visibleSongs.length,
    });
  }, [albums.length, artists.length, loading, radioStations.length, songs.length, visibleSongs.length]);

  const copyFavoritesBrowseDiagnostics = async () => {
    const text = formatFavoritesBrowseTraceReport({
      route: '/favorites',
      libraryScopeCount: getLibraryBrowseScope().pairs.length,
      loading,
      albumCount: albums.length,
      artistCount: artists.length,
      songCount: songs.length,
      visibleSongCount: visibleSongs.length,
      radioStationCount: radioStations.length,
      traceEntryCount: favoritesTraceEntries.length,
    });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access may be unavailable in an embedded webview permission state.
    }
  };


  if (loading) {
    return (
      <div className="content-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '4rem' }}>
        <div className="spinner" />
        {favoritesBrowseDiagnosticsEnabled && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void copyFavoritesBrowseDiagnostics()}
          >
            {t('albums.copyDiagnostics')}
          </button>
        )}
      </div>
    );
  }
  // Check if user has any favorites (using original unfiltered lists)
  const hasAnyFavorites = albums.length > 0 || artists.length > 0 || songs.length > 0 || radioStations.length > 0;
  const hasSongFilters = !!(selectedArtist || selectedGenres.length > 0 || yearRange[0] !== MIN_YEAR || yearRange[1] !== CURRENT_YEAR);

  const sectionHasData = (id: FavoritesSectionId): boolean => {
    switch (id) {
      case 'artists':    return artists.length > 0;
      case 'albums':     return albums.length > 0;
      case 'stations':   return radioStations.length > 0;
      case 'topArtists': return topFavoriteArtists.length >= 2;
      // Stays up while a filter empties the list, so the filter can be cleared.
      case 'songs':      return visibleSongs.length > 0 || hasSongFilters;
    }
  };
  // Order and visibility come from Settings → Personalisation.
  const renderableSectionIds = sectionConfig
    .filter(s => s.visible)
    .map(s => s.id)
    .filter(sectionHasData);

  return (
    <div className="content-body animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
      {favoritesBrowseDiagnosticsEnabled && (
        <div className="mainstage-diagnostic-copy-all">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void copyFavoritesBrowseDiagnostics()}
          >
            {t('albums.copyDiagnostics')}
          </button>
        </div>
      )}
      <div className="playlists-header" style={{ marginBottom: '-1.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{t('favorites.title')}</h1>
        <FavoritesOfflineHeader />
      </div>

      {!hasAnyFavorites ? (
        <div className="empty-state">{t('favorites.empty')}</div>
      ) : (
        <>
          {/* The albums heading opens All Albums with its favourites filter on
              (#1556), the artists heading opens Artists the same way. A row of
              six is fine as a glance; for hundreds of favourites the page
              there is the place to browse, with its sorting, filters and
              paging. */}
          {renderableSectionIds.map(sectionId => {
            switch (sectionId) {
              case 'artists': return (
                <ArtistRow
                  key="artists"
                  title={t('favorites.artists')}
                  onTitleClick={() => openFavoriteArtists(navigate)}
                  artists={artists}
                />
              );

              case 'albums': return (
                <AlbumRow
                  key="albums"
                  title={t('favorites.albums')}
                  onTitleClick={() => openFavoriteAlbums(navigate)}
                  albums={albums}
                />
              );

              case 'stations': return (
                <RadioStationRow
                  key="stations"
                  title={t('favorites.stations')}
                  stations={radioStations}
                  currentRadio={currentRadio}
                  isPlaying={isPlaying}
                  onPlay={s => {
                    if (sameRadioStation(currentRadio, s) && isPlaying) stop();
                    else playRadio(s);
                  }}
                  onUnfavorite={unfavoriteStation}
                />
              );

              case 'topArtists': return (
                <TopFavoriteArtistsRow
                  key="topArtists"
                  title={t('favorites.topArtists')}
                  artists={topFavoriteArtists}
                  selectedKey={selectedArtist}
                  onToggle={key => setSelectedArtist(prev => prev === key ? null : key)}
                />
              );

              case 'songs': return (
                <section key="songs" className="album-row-section">
                  <FavoritesSongsSectionHeader
                    visibleSongs={visibleSongs}
                    songs={songs}
                    selectedArtist={selectedArtist}
                    selectedArtistName={selectedArtistName}
                    setSelectedArtist={setSelectedArtist}
                    selectedGenres={selectedGenres}
                    setSelectedGenres={setSelectedGenres}
                    yearRange={yearRange}
                    setYearRange={setYearRange}
                    showFilters={showFilters}
                    setShowFilters={setShowFilters}
                    setSortKey={setSortKey}
                    setSortClickCount={setSortClickCount}
                    playTrack={playTrack}
                    enqueue={enqueue}
                    starredOverrides={starredOverrides}
                    minYear={MIN_YEAR}
                    currentYear={CURRENT_YEAR}
                    inSelectMode={inSelectMode}
                    selectedCount={selectedCount}
                    selectedIds={selectedIds}
                    showPlPicker={showPlPicker}
                    setShowPlPicker={setShowPlPicker}
                    ratings={ratings}
                    onRate={handleRate}
                  />
                  <FavoritesSongsTracklist
                    visibleSongs={visibleSongs}
                    selectedIds={selectedIds}
                    selectedCount={selectedCount}
                    inSelectMode={inSelectMode}
                    toggleSelect={toggleSelect}
                    allColumns={FAV_COLUMNS}
                    visibleCols={tracklistCols}
                    gridStyle={gridStyle}
                    colVisible={colVisible}
                    toggleColumn={toggleColumn}
                    resetColumns={resetColumns}
                    pickerOpen={pickerOpen}
                    setPickerOpen={setPickerOpen}
                    pickerRef={pickerRef}
                    tracklistRef={tracklistRef}
                    startResize={startResize}
                    startFlexColumnResize={startFlexColumnResize}
                    handleSortClick={handleSortClick}
                    getSortIndicator={getSortIndicator}
                    ratings={ratings}
                    handleRate={handleRate}
                    removeSong={removeSong}
                    hasFilters={hasSongFilters}
                  />
                </section>
              );
            }
          })}
        </>
      )}
    </div>
  );
}
