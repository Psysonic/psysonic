import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, X } from 'lucide-react';
import { usePlayerStore } from '@/features/playback';
import { usePlaylistTagStore } from '@/features/playlist/store/playlistTagStore';
import { playlistTagKey } from '@/features/playlist/utils/playlistTags';

interface Props {
  tags: readonly string[];
  activeKeys: readonly string[];
}

/**
 * Filter chips over the Playlists grid. Each chip narrows the list further
 * (all switched-on tags must match). Right-click opens rename / delete in the
 * shared context menu.
 */
export default function PlaylistTagFilterBar({ tags, activeKeys }: Props) {
  const { t } = useTranslation();
  const toggleFilter = usePlaylistTagStore(s => s.toggleFilter);
  const clearFilter = usePlaylistTagStore(s => s.clearFilter);
  const openContextMenu = usePlayerStore(s => s.openContextMenu);

  if (tags.length === 0) return null;

  const openTagMenu = (e: React.MouseEvent<HTMLButtonElement>, name: string) => {
    e.preventDefault();
    let { clientX: x, clientY: y } = e;
    // Opened from the keyboard (context-menu key / Shift+F10) there is no pointer position.
    if (x === 0 && y === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      x = rect.left;
      y = rect.bottom;
    }
    openContextMenu(x, y, { name }, 'playlist-tag');
  };

  return (
    <div className="playlist-tag-bar" role="group" aria-label={t('playlists.tags.filterLabel')}>
      <Tag size={14} className="playlist-tag-bar__icon" aria-hidden="true" />
      {tags.map(name => {
        const active = activeKeys.includes(playlistTagKey(name));
        return (
          <button
            key={playlistTagKey(name)}
            type="button"
            className={`playlist-tag-chip${active ? ' active' : ''}`}
            aria-pressed={active}
            data-tooltip={t('playlists.tags.chipHint')}
            onClick={() => toggleFilter(name)}
            onContextMenu={e => openTagMenu(e, name)}
          >
            {name}
          </button>
        );
      })}
      {activeKeys.length > 0 && (
        <button
          type="button"
          className="playlist-tag-clear"
          aria-label={t('playlists.tags.clearFilter')}
          data-tooltip={t('playlists.tags.clearFilter')}
          onClick={clearFilter}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
