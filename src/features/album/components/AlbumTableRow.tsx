import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/features/playback';
import { useNavigateToAlbum } from '@/features/album/hooks/useNavigateToAlbum';
import { useAlbumDragStart } from '@/features/album/hooks/useAlbumDragStart';
import { CoverArtImage } from '@/cover/CoverArtImage';
import { useAlbumCoverRef } from '@/cover/useLibraryCoverRef';
import { coverStorageKeyFromRef } from '@/cover/storageKeys';
import { coverServerScopeForServerId } from '@/cover/serverScope';
import { resolveCoverDisplayTier } from '@/cover/tiers';
import { COVER_TRACK_ROW_CSS_PX } from '@/cover/layoutSizes';
import { ResolvedArtistRefInline } from '@/ui/ResolvedArtistRefInline';
import { albumArtistDisplayName, deriveAlbumArtistRefs } from '@/features/album/utils/deriveAlbumHeaderArtistRefs';
import { appendServerQuery, buildArtistDetailPath } from '@/lib/navigation/detailServerScope';
import { formatLongDuration } from '@/lib/format/formatDuration';
import { formatAlbumYear } from '@/features/album/utils/albumYear';
import { useAlbumYearDisplay } from '@/features/album/store/albumYearDisplayStore';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { TracklistCell } from '@/ui/tracklist/TracklistCell';

/** Em dash for a column the server left empty. */
const EMPTY_CELL = '\u2014';

interface AlbumTableRowProps {
  album: SubsonicAlbum;
  /** Columns in their current order (the table's `useTracklistColumns`). */
  visibleCols: readonly ColDef[];
  gridStyle: React.CSSProperties;
  /** 1-based position in the full list, for `aria-rowindex` under virtualization. */
  rowIndex: number;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: (opts?: { shiftKey?: boolean }) => void;
  selectedAlbums: SubsonicAlbum[];
  /** Appended to `/album/:id`, e.g. `lossless=1`. */
  linkQuery?: string;
  observeScrollRootId?: string;
}

function formatAddedDate(created: string | undefined, locale: string): string {
  if (!created) return EMPTY_CELL;
  const ms = Date.parse(created);
  if (!Number.isFinite(ms)) return EMPTY_CELL;
  try {
    return new Date(ms).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return EMPTY_CELL;
  }
}

function AlbumTableRow({
  album,
  visibleCols,
  gridStyle,
  rowIndex,
  selected,
  selectionMode,
  onToggleSelect,
  selectedAlbums,
  linkQuery,
  observeScrollRootId,
}: AlbumTableRowProps) {
  const { t, i18n } = useTranslation();
  const albumYearDisplay = useAlbumYearDisplay();
  const navigate = useNavigate();
  const navigateToAlbum = useNavigateToAlbum();
  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const activeServerId = useAuthStore(s => s.activeServerId ?? '');

  const coverServerScope = useMemo(
    () => coverServerScopeForServerId(album.serverId),
    [album.serverId],
  );
  // `libraryResolve: false` mirrors what the album card is given on these same
  // pages — the browse payload already carries a usable `coverArt`, so a
  // per-row library_resolve IPC would only add traffic per visible row.
  const coverRef = useAlbumCoverRef(album.id, album.coverArt, coverServerScope, {
    libraryResolve: false,
  });
  const dragCoverKey = useMemo(() => {
    if (!coverRef) return '';
    return coverStorageKeyFromRef(
      coverRef,
      resolveCoverDisplayTier(COVER_TRACK_ROW_CSS_PX, { surface: 'dense' }),
    );
  }, [coverRef]);
  const handleDragStart = useAlbumDragStart(album, dragCoverKey, selectionMode);

  const albumLinkQuery = useMemo(
    () => appendServerQuery(linkQuery, album.serverId),
    [linkQuery, album.serverId],
  );
  const artistRefs = useMemo(() => deriveAlbumArtistRefs(album), [album]);
  const artistLabel = useMemo(() => albumArtistDisplayName(album), [album]);
  const addedLabel = useMemo(
    () => formatAddedDate(album.created, i18n.language),
    [album.created, i18n.language],
  );

  const activate = (opts?: { shiftKey?: boolean }) => {
    if (selectionMode) { onToggleSelect(opts); return; }
    navigateToAlbum(album.id, { search: albumLinkQuery });
  };

  const renderCell = (key: string) => {
    switch (key) {
      case 'cover':
        return (
          <span className="album-table__cover-wrap">
          {coverRef ? (
            <CoverArtImage
              coverRef={coverRef}
              displayCssPx={COVER_TRACK_ROW_CSS_PX}
              surface="dense"
              className="album-table__cover"
              ensureOpts={{ artistName: artistLabel, albumTitle: album.name }}
              alt=""
              loading="lazy"
              decoding="async"
              observeScrollRootId={observeScrollRootId}
            />
          ) : (
            <div className="album-table__cover album-table__cover--placeholder" aria-hidden="true" />
          )}
          {selectionMode && (
            // Purely visual: the state it shows is announced on the title button,
            // which is the element keyboard focus actually reaches and the control
            // that toggles selection while the mode is on.
            <span
              className={`album-table__select${selected ? ' album-table__select--on' : ''}`}
              aria-hidden="true"
            >
              {selected && <Check size={12} strokeWidth={3} />}
            </span>
          )}
          </span>
        );
      case 'title':
        return (
          <>
          <button
            type="button"
            className="album-table__title-btn truncate"
            onClick={e => { e.stopPropagation(); activate({ shiftKey: e.shiftKey }); }}
            aria-label={t('common.albumByArtist', { album: album.name, artist: artistLabel })}
            // In selection mode this button toggles the row instead of opening the
            // album, so it is also where the state belongs. `aria-selected` on the
            // row would carry only inside role="grid"/"treegrid", and promoting the
            // table to one would advertise cell-wise keyboard navigation it lacks.
            aria-pressed={selectionMode ? selected : undefined}
          >
            {album.name}
          </button>
          </>
        );
      case 'artist':
        return (
          <>
          <span className="album-table__artist truncate">
            <ResolvedArtistRefInline
              refs={artistRefs}
              serverId={album.serverId ?? activeServerId}
              fallbackName={artistLabel}
              onGoArtist={id => navigate(buildArtistDetailPath(id, { serverId: album.serverId }))}
              as="none"
              linkTag="span"
              linkClassName="track-artist-link"
            />
          </span>
          </>
        );
      case 'songs':
        return (
          <>
          {album.songCount > 0 ? album.songCount : EMPTY_CELL}
          </>
        );
      case 'year':
        return (
          <>
          {formatAlbumYear(album, albumYearDisplay) ?? EMPTY_CELL}
          </>
        );
      case 'duration':
        return (
          <>
          {album.duration > 0 ? formatLongDuration(album.duration) : EMPTY_CELL}
          </>
        );
      case 'added':
        return (
          <>
          {addedLabel}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div
      style={gridStyle}
      className={`album-table__row album-table__grid${selected ? ' album-table__row--selected' : ''}`}
      role="row"
      aria-rowindex={rowIndex}
      onClick={e => activate({ shiftKey: e.shiftKey })}
      onMouseDown={handleDragStart}
      onContextMenu={e => {
        e.preventDefault();
        if (selectionMode && selectedAlbums.length > 0) {
          openContextMenu(e.clientX, e.clientY, selectedAlbums, 'multi-album');
        } else {
          openContextMenu(e.clientX, e.clientY, album, 'album');
        }
      }}
    >
      {visibleCols.map(col => (
        <TracklistCell
          key={col.key}
          col={col}
          role="cell"
          className={`album-table__cell album-table__cell--${col.key}`}
          text={col.key === 'title' ? album.name : col.key === 'artist' ? artistLabel : undefined}
        >
          {renderCell(col.key)}
        </TracklistCell>
      ))}
    </div>
  );
}

// No `memo` here, unlike `AlbumCard`: a row also takes the selection callback and
// the selected-album list, and both are rebuilt on every parent render, so the
// comparison could never short-circuit — it would only add cost. Rows are
// virtualized, so only the visible window renders either way.
export default AlbumTableRow;
