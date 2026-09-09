import React from 'react';
import { ListPlus, Search, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useSelectionStore } from '@/store/selectionStore';
import { BulkTrackRating } from '@/features/playback';
import { AddToPlaylistSubmenu } from '@/features/contextMenu/components/ContextMenu';
import { offlineActionPolicy, type OfflineActionPolicy } from '@/features/offline';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { resolveIndexKey } from '@/lib/server/serverIndexKey';

interface Props {
  filterText: string;
  setFilterText: (v: string) => void;
  inSelectMode: boolean;
  selectedCount: number;
  showPlPicker: boolean;
  setShowPlPicker: React.Dispatch<React.SetStateAction<boolean>>;
  t: TFunction;
  actionPolicy?: OfflineActionPolicy;
  songs: SubsonicSong[];
  ratings: Record<string, number>;
  onRate: (song: SubsonicSong, rating: number) => void;
}

/**
 * Toolbar above the album tracklist. The filter input narrows the
 * visible songs by title/artist; the bulk-action cluster only appears
 * while the global selection store has at least one item picked.
 *
 * The "Add to playlist" picker is a portal-aware popover (closes on
 * outside mousedown, see AlbumDetail page effect) so the parent owns
 * `showPlPicker` to coordinate that close with selection clears.
 */
export function AlbumDetailToolbar({
  filterText,
  setFilterText,
  inSelectMode,
  selectedCount,
  showPlPicker,
  setShowPlPicker,
  t,
  actionPolicy,
  songs,
  ratings,
  onRate,
}: Props) {
  const policy = actionPolicy ?? offlineActionPolicy('albumDetail', false);
  const selectedIds = useSelectionStore(s => s.selectedIds);
  const selectedSongs = songs.filter(song => selectedIds.has(ownedEntityKey(song)));
  const selectedOwnerKeys = new Set(
    selectedSongs.map(song => song.serverId ? resolveIndexKey(song.serverId) : '').filter(Boolean),
  );
  const playlistOwner = selectedOwnerKeys.size === 1 ? selectedSongs[0]?.serverId : undefined;
  const canAddSelectionToPlaylist = policy.canAddToPlaylist
    && selectedSongs.length > 0
    && selectedSongs.length === selectedIds.size
    && !!playlistOwner;
  return (
    <div className="album-track-toolbar">
      <div className="album-track-toolbar-filter">
        <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input
          className="input-search"
          style={{ width: '100%', paddingRight: filterText ? 28 : undefined }}
          placeholder={t('albumDetail.filterSongs')}
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
        />
        {filterText && (
          <button
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setFilterText('')}
            aria-label="Clear filter"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="album-track-toolbar-actions">
        {inSelectMode && (
          <>
            <span className="bulk-action-count">
              {t('common.bulkSelected', { count: selectedCount })}
            </span>
            {policy.canRate && (
              <BulkTrackRating tracks={selectedSongs} ratings={ratings} onRate={onRate} />
            )}
            {canAddSelectionToPlaylist && (
              <div className="bulk-pl-picker-wrap">
                <button
                  className="btn btn-surface btn-sm"
                  onClick={() => setShowPlPicker(v => !v)}
                >
                  <ListPlus size={14} />
                  {t('common.bulkAddToPlaylist')}
                </button>
                {showPlPicker && (
                  <AddToPlaylistSubmenu
                    songIds={selectedSongs.map(song => song.id)}
                    serverId={playlistOwner}
                    onDone={() => { setShowPlPicker(false); useSelectionStore.getState().clearAll(); }}
                    dropDown
                  />
                )}
              </div>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => useSelectionStore.getState().clearAll()}
            >
              <X size={13} />
              {t('common.bulkClear')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
