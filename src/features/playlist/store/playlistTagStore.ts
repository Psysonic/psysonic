import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  normalizePlaylistTagName,
  playlistTagKey,
  type PlaylistTagTarget,
  type PlaylistTagsByServer,
} from '@/features/playlist/utils/playlistTags';
import { createNavidromeCanonicalMigrationAwareJSONStorage } from '@/lib/util/safeStorage';

interface PlaylistTagState {
  byServer: PlaylistTagsByServer;
  /** Filter chips switched on in the Playlists page, as tag keys; all must match. */
  activeFilter: string[];
  addTag: (targets: readonly PlaylistTagTarget[], name: string) => void;
  removeTag: (targets: readonly PlaylistTagTarget[], name: string) => void;
  /** Renaming onto an existing tag merges the two, keeping the existing spelling. */
  renameTag: (from: string, to: string) => void;
  /** Removes the tag from every playlist. */
  deleteTag: (name: string) => void;
  toggleFilter: (name: string) => void;
  clearFilter: () => void;
}

function spellingFor(byServer: PlaylistTagsByServer, key: string): string | undefined {
  for (const bucket of Object.values(byServer)) {
    for (const tags of Object.values(bucket)) {
      const match = tags.find(tag => playlistTagKey(tag) === key);
      if (match) return match;
    }
  }
  return undefined;
}

function withTags(
  byServer: PlaylistTagsByServer,
  serverId: string,
  playlistId: string,
  tags: string[],
): PlaylistTagsByServer {
  const bucket = { ...byServer[serverId] };
  if (tags.length > 0) bucket[playlistId] = tags;
  else delete bucket[playlistId];
  const next = { ...byServer };
  if (Object.keys(bucket).length > 0) next[serverId] = bucket;
  else delete next[serverId];
  return next;
}

/** Rewrite every playlist's tag list; empty lists and buckets are dropped. */
function mapAllTags(
  byServer: PlaylistTagsByServer,
  fn: (tags: string[]) => string[],
): PlaylistTagsByServer {
  const next: PlaylistTagsByServer = {};
  for (const [serverId, bucket] of Object.entries(byServer)) {
    const nextBucket: Record<string, string[]> = {};
    for (const [playlistId, tags] of Object.entries(bucket)) {
      const mapped = fn(tags);
      if (mapped.length > 0) nextBucket[playlistId] = mapped;
    }
    if (Object.keys(nextBucket).length > 0) next[serverId] = nextBucket;
  }
  return next;
}

function dedupeByKey(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.filter(tag => {
    const key = playlistTagKey(tag);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A filter chip whose tag no playlist carries anymore must not keep the list empty. */
function pruneFilter(byServer: PlaylistTagsByServer, activeFilter: string[]): string[] {
  const pruned = activeFilter.filter(key => spellingFor(byServer, key) !== undefined);
  return pruned.length === activeFilter.length ? activeFilter : pruned;
}

export const usePlaylistTagStore = create<PlaylistTagState>()(
  persist(
    set => ({
      byServer: {},
      activeFilter: [],

      addTag: (targets, name) => set(state => {
        const normalized = normalizePlaylistTagName(name);
        if (!normalized) return {};
        const key = playlistTagKey(normalized);
        const spelling = spellingFor(state.byServer, key) ?? normalized;
        let byServer = state.byServer;
        for (const { serverId, playlistId } of targets) {
          const tags = byServer[serverId]?.[playlistId] ?? [];
          if (tags.some(tag => playlistTagKey(tag) === key)) continue;
          byServer = withTags(byServer, serverId, playlistId, [...tags, spelling]);
        }
        return { byServer };
      }),

      removeTag: (targets, name) => set(state => {
        const key = playlistTagKey(name);
        let byServer = state.byServer;
        for (const { serverId, playlistId } of targets) {
          const tags = byServer[serverId]?.[playlistId];
          if (!tags) continue;
          byServer = withTags(byServer, serverId, playlistId, tags.filter(tag => playlistTagKey(tag) !== key));
        }
        return { byServer, activeFilter: pruneFilter(byServer, state.activeFilter) };
      }),

      renameTag: (from, to) => set(state => {
        const fromKey = playlistTagKey(from);
        const normalized = normalizePlaylistTagName(to);
        if (!fromKey || !normalized) return {};
        const toKey = playlistTagKey(normalized);
        const spelling = toKey === fromKey
          ? normalized
          : spellingFor(state.byServer, toKey) ?? normalized;
        const byServer = mapAllTags(state.byServer, tags => dedupeByKey(
          tags.map(tag => (playlistTagKey(tag) === fromKey ? spelling : tag)),
        ));
        const activeFilter = [...new Set(
          state.activeFilter.map(key => (key === fromKey ? toKey : key)),
        )];
        return { byServer, activeFilter };
      }),

      deleteTag: name => set(state => {
        const key = playlistTagKey(name);
        return {
          byServer: mapAllTags(state.byServer, tags => tags.filter(tag => playlistTagKey(tag) !== key)),
          activeFilter: state.activeFilter.filter(active => active !== key),
        };
      }),

      toggleFilter: name => set(state => {
        const key = playlistTagKey(name);
        if (!key) return {};
        return {
          activeFilter: state.activeFilter.includes(key)
            ? state.activeFilter.filter(active => active !== key)
            : [...state.activeFilter, key],
        };
      }),

      clearFilter: () => set({ activeFilter: [] }),
    }),
    {
      name: 'psysonic_playlist_tags',
      storage: createNavidromeCanonicalMigrationAwareJSONStorage(),
      onRehydrateStorage: () => state => {
        if (!state) return;
        // A hand-edited store or an imported backup must not leave the page on a
        // filter it can no longer render.
        if (typeof state.byServer !== 'object' || state.byServer === null) state.byServer = {};
        if (!Array.isArray(state.activeFilter)) state.activeFilter = [];
        state.activeFilter = state.activeFilter.filter(key => typeof key === 'string');
      },
    },
  ),
);
