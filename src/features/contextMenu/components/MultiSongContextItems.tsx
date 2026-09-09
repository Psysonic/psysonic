import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronsRight, Flame, Heart, ListMusic, ListPlus, Play, Star } from 'lucide-react';
import type { Track } from '@/lib/media/trackTypes';
import StarRating from '@/ui/StarRating';
import { queueSongStar } from '@/features/playback';
import { multiTrackRatingId, unifiedTrackRating } from '@/lib/media/trackRating';
import { addTracksToBurnList } from '@/features/burner';
import { resolveMediaServerId } from '@/features/offline';
import { AddToPlaylistSubmenu } from '@/features/contextMenu/components/AddToPlaylistSubmenu';
import type { ContextMenuItemsProps } from '@/features/contextMenu/components/contextMenuItemTypes';
import { useBurnMenuAvailable } from '@/features/contextMenu/hooks/useBurnMenuAvailable';

/**
 * Menu for a multi-row track selection.
 *
 * It carries the entries of the single-track menu that mean something for a
 * set of rows — playback, queue, playlist, favourite, rating — and drops the
 * ones that address exactly one track (open album, go to artist, radio,
 * share, song info), which have no answer for a selection.
 */
export default function MultiSongContextItems(props: ContextMenuItemsProps) {
  const {
    item, playTrack, playNext, enqueue, closeContextMenu,
    userRatingOverrides, setKeyboardRating, keyboardRating, applySongRating,
    playlistSubmenuOpen, setPlaylistSubmenuOpen, cancelPlaylistSubmenuCloseTimer,
    onPlaylistSubmenuTriggerMouseLeave, playlistSongIds, setPlaylistSongIds,
    handleAction, isStarred, offlinePolicy,
  } = props;
  const { t } = useTranslation();
  const burnAvailable = useBurnMenuAvailable(offlinePolicy);
  const songs = item as Track[];
  const ratingId = multiTrackRatingId(songs);
  const playlistTriggerId = `multi-song:${songs.map(song => song.id).join(',')}`;
  const ownerServerIds = new Set(songs.map(song => song.serverId).filter(Boolean));
  // A playlist lives on one server, so a mixed-owner selection has no target.
  const playlistOwner = ownerServerIds.size <= 1 ? songs[0]?.serverId : undefined;
  const allStarred = songs.every(song => isStarred(song.id, song.starred, song.serverId));

  return (
    <>
      <div className="context-menu-header">
        {t('contextMenu.selectedSongs', { count: songs.length })}
      </div>
      <div className="context-menu-item" onClick={() => handleAction(() => playTrack(songs[0], songs, true))}>
        <Play size={14} /> {t('contextMenu.playNow')}
      </div>
      <div className="context-menu-item" onClick={() => handleAction(() => playNext(songs))}>
        <ChevronsRight size={14} /> {t('contextMenu.playNext')}
      </div>
      <div className="context-menu-item" onClick={() => handleAction(() => enqueue(songs))}>
        <ListPlus size={14} /> {t('contextMenu.addToQueue')}
      </div>
      {offlinePolicy.canAddToPlaylist && ownerServerIds.size <= 1 && (
        <div
          className={`context-menu-item context-menu-item--submenu ${playlistSubmenuOpen && playlistSongIds[0] === playlistTriggerId ? 'active' : ''}`}
          data-playlist-trigger-id={playlistTriggerId}
          onMouseEnter={() => { cancelPlaylistSubmenuCloseTimer(); setPlaylistSongIds([playlistTriggerId]); setPlaylistSubmenuOpen(true); }}
          onMouseLeave={onPlaylistSubmenuTriggerMouseLeave}
        >
          <ListMusic size={14} /> {t('contextMenu.addToPlaylist')}
          <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
          {playlistSubmenuOpen && playlistSongIds[0] === playlistTriggerId && (
            <AddToPlaylistSubmenu
              songIds={songs.map(song => song.id)}
              serverId={playlistOwner}
              triggerId={playlistTriggerId}
              onDone={() => { setPlaylistSubmenuOpen(false); closeContextMenu(); }}
            />
          )}
        </div>
      )}
      {burnAvailable && (
        <div className="context-menu-item" onClick={() => handleAction(() => {
          // Each track keeps its own owner; the active server is only a
          // fallback for rows that never carried one.
          addTracksToBurnList(songs, resolveMediaServerId(songs[0]?.serverId) ?? '');
        })}>
          <Flame size={14} /> {t('burner.addToCd')}
        </div>
      )}
      {offlinePolicy.canFavorite && (
        <>
          <div className="context-menu-divider" />
          <div className="context-menu-item" onClick={() => handleAction(() => {
            for (const song of songs) {
              queueSongStar(song.id, !allStarred, song.serverId, { scopedOverride: true });
            }
          })}>
            <Heart size={14} fill={allStarred ? 'currentColor' : 'none'} />
            {allStarred ? t('contextMenu.unfavorite') : t('contextMenu.favorite')}
          </div>
        </>
      )}
      {offlinePolicy.canRate && (
        <div
          className="context-menu-rating-row"
          data-rating-kind="song"
          data-rating-id={ratingId}
          data-rating-disabled="false"
          onClick={e => e.stopPropagation()}
        >
          <Star size={14} className="context-menu-rating-icon" aria-hidden />
          <StarRating
            value={keyboardRating?.kind === 'song' && keyboardRating.id === ratingId
              ? keyboardRating.value
              : unifiedTrackRating(songs, userRatingOverrides)}
            ariaLabel={t('entityRating.selectedSongsRatingAriaLabel', { count: songs.length })}
            onChange={rating => {
              setKeyboardRating({ kind: 'song', id: ratingId, value: rating });
              for (const song of songs) applySongRating(song, rating);
            }}
          />
        </div>
      )}
    </>
  );
}
