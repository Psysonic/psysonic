import { useMemo } from 'react';
import { usePlaylistTagStore } from '@/features/playlist/store/playlistTagStore';
import {
  collectPlaylistTags,
  playlistTagKey,
  type PlaylistTagsByServer,
} from '@/features/playlist/utils/playlistTags';

interface PlaylistTagFilter {
  byServer: PlaylistTagsByServer;
  /** Tags carried by the loaded playlists — the chips the page offers. */
  availableTags: string[];
  /** Switched-on chips that still match an offered tag. */
  activeKeys: string[];
}

/**
 * Chips are collected over the whole loaded list, not the visible one, so they
 * do not come and go while someone types in the search box. A remembered chip
 * whose tag is no longer on any loaded playlist (scope switched to another
 * server, playlist deleted elsewhere) is ignored rather than leaving the page
 * empty with no chip to switch off.
 */
export function usePlaylistTagFilter(
  playlists: readonly { id: string; serverId?: string }[],
): PlaylistTagFilter {
  const byServer = usePlaylistTagStore(s => s.byServer);
  const activeFilter = usePlaylistTagStore(s => s.activeFilter);
  const availableTags = useMemo(
    () => collectPlaylistTags(byServer, playlists),
    [byServer, playlists],
  );
  const activeKeys = useMemo(() => {
    const offered = new Set(availableTags.map(playlistTagKey));
    return activeFilter.filter(key => offered.has(key));
  }, [activeFilter, availableTags]);
  return { byServer, availableTags, activeKeys };
}
