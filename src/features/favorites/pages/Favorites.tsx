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
import { useScopedBrowseSearchQuery } from '@/store/liveSearchScopeStore';
import { matchesFavoritesSearch, normalizeFavoritesSearchQuery } from '@/features/favorites/utils/favoritesSearch';
import { ChevronDown } from 'lucide-react';

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
type CollapsibleFavoritesSectionId = Exclude<FavoritesSectionId, 'songs'>;

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
  const favoritesSearchQuery = useScopedBrowseSearchQuery('favorites');
  const favoritesSearchNeedle = useMemo(
    () => normalizeFavoritesSearchQuery(favoritesSearchQuery),
    [favoritesSearchQuery],
  );
  const favoritesSearchActive = favoritesSearchNeedle.length > 0;
  const [expandedSearchSection, setExpandedSearchSection] = useState<CollapsibleFavoritesSectionId | null>(null);

  useEffect(() => {
    if (favoritesSearchActive) return;
    // A fresh query starts a fresh auto-collapse session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedSearchSection(current => current == null ? current : null);
  }, [favoritesSearchActive]);

  const searchedAlbums = useMemo(
    () => albums.filter(album => matchesFavoritesSearch(
      favoritesSearchNeedle,
      album.name,
      album.artist,
      album.genre,
      album.year,
    )),
    [albums, favoritesSearchNeedle],
  );
  const searchedArtists = useMemo(
    () => artists.filter(artist => matchesFavoritesSearch(favoritesSearchNeedle, artist.name)),
    [artists, favoritesSearchNeedle],
  );
  const searchedRadioStations = useMemo(
    () => radioStations.filter(station => matchesFavoritesSearch(favoritesSearchNeedle, station.name)),
    [radioStations, favoritesSearchNeedle],
  );
  const searchedTopFavoriteArtists = useMemo(
    () => topFavoriteArtists.filter(artist => matchesFavoritesSearch(favoritesSearchNeedle, artist.name)),
    [topFavoriteArtists, favoritesSearchNeedle],
  );

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
    selectedArtist, selectedGenres, yearRange, ratings, searchQuery: favoritesSearchQuery,
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
  const hasSongFilters = !!(
    favoritesSearchActive
    || selectedArtist
    || selectedGenres.length > 0
    || yearRange[0] !== MIN_YEAR
    || yearRange[1] !== CURRENT_YEAR
  );

  const isSearchSectionCollapsed = (id: CollapsibleFavoritesSectionId) => (
    favoritesSearchActive && expandedSearchSection !== id
  );
  const selectSearchSection = (id: CollapsibleFavoritesSectionId) => {
    setExpandedSearchSection(current => current === id ? null : id);
  };
  const sectionHasData = (id: FavoritesSectionId): boolean => {
    if (favoritesSearchActive) return true;
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
  type SearchSectionSummary = {
    id: CollapsibleFavoritesSectionId;
    label: string;
    count: number;
  };
  const allSearchSectionSummaries: SearchSectionSummary[] = [
    { id: 'artists', label: t('favorites.artists'), count: searchedArtists.length },
    { id: 'albums', label: t('favorites.albums'), count: searchedAlbums.length },
    { id: 'stations', label: t('favorites.stations'), count: searchedRadioStations.length },
    { id: 'topArtists', label: t('favorites.topArtists'), count: searchedTopFavoriteArtists.length },
  ];
  const searchSectionSummaries = allSearchSectionSummaries
    .filter(section => renderableSectionIds.includes(section.id));

  const renderSection = (sectionId: FavoritesSectionId, compactSearchRail = false) => {
    switch (sectionId) {
      case 'artists': return (
        <ArtistRow
          key="artists"
          title={t('favorites.artists')}
          onTitleClick={compactSearchRail ? undefined : () => openFavoriteArtists(navigate)}
          artists={searchedArtists}
          hideTitle={compactSearchRail}
        />
      );

      case 'albums': return (
        <AlbumRow
          key="albums"
          title={t('favorites.albums')}
          onTitleClick={compactSearchRail ? undefined : () => openFavoriteAlbums(navigate)}
          albums={searchedAlbums}
          hideTitle={compactSearchRail}
        />
      );

      case 'stations': return (
        <RadioStationRow
          key="stations"
          title={t('favorites.stations')}
          stations={searchedRadioStations}
          currentRadio={currentRadio}
          isPlaying={isPlaying}
          hideTitle={compactSearchRail}
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
          artists={searchedTopFavoriteArtists}
          selectedKey={selectedArtist}
          onToggle={key => setSelectedArtist(prev => prev === key ? null : key)}
          hideTitle={compactSearchRail}
        />
      );

      case 'songs': return (
        <section key="songs" className="album-row-section">
          <FavoritesSongsSectionHeader
            visibleSongs={visibleSongs}
            songs={songs}
            titleCount={favoritesSearchActive ? visibleSongs.length : undefined}
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
  };

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
          {favoritesSearchActive ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div
                  role="group"
                  aria-label={t('search.scopeFavoritesPlaceholder')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexWrap: 'nowrap',
                    overflowX: 'auto',
                  }}
                >
                  {searchSectionSummaries.map(({ id, label, count }) => {
                    const expanded = count > 0 && !isSearchSectionCollapsed(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`btn ${expanded ? 'btn-primary' : 'btn-surface'}`}
                        onClick={() => selectSearchSection(id)}
                        disabled={count === 0}
                        aria-expanded={count > 0 ? expanded : undefined}
                        aria-label={`${label} (${count})`}
                        style={{
                          flex: '0 0 auto',
                          padding: '0.35rem 0.6rem',
                          gap: '0.3rem',
                          fontSize: '0.78rem',
                        }}
                      >
                        <span>{label}</span>
                        <span style={{ color: 'var(--text-muted)' }}>({count})</span>
                        {count > 0 && (
                          <ChevronDown
                            size={14}
                            aria-hidden
                            style={{
                              transform: expanded ? undefined : 'rotate(-90deg)',
                              transition: 'transform 0.2s ease',
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {searchSectionSummaries.map(({ id, count }) => (
                  count > 0 && !isSearchSectionCollapsed(id)
                    ? renderSection(id, true)
                    : null
                ))}
              </div>

              {renderableSectionIds.includes('songs') ? renderSection('songs') : null}
            </>
          ) : (
            renderableSectionIds.map(sectionId => renderSection(sectionId))
          )}
        </>
      )}
    </div>
  );
}
