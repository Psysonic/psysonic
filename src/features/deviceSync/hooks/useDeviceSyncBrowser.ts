import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlaylistsForServer } from '@/lib/api/subsonicPlaylists';
import { getArtistsForServer, getArtistForServer } from '@/lib/api/subsonicArtists';
import { getAlbumListForServer } from '@/lib/api/subsonicLibrary';
import { searchForServer } from '@/lib/api/subsonicSearch';
import type {
  SubsonicAlbum, SubsonicArtist, SubsonicPlaylist,
} from '@/lib/api/subsonicTypes';
import type { SourceTab } from '@/features/deviceSync/utils/deviceSyncHelpers';
import {
  deviceSyncOwnerKey,
  deviceSyncUnresolvedOwnerKey,
  useDeviceSyncStore,
} from '@/features/deviceSync/store/deviceSyncStore';
import { resolveStorageServerIndexKey } from '@/lib/server/serverIndexKey';
import {
  findServerInListByIdOrIndexKey,
  resolveServerIdForIndexKey,
} from '@/lib/server/serverLookup';
import { useAuthStore } from '@/store/authStore';

export interface DeviceSyncBrowserResult {
  serverIndexKey: string | null;
  /** Stable identity of the server being browsed, recorded on new sources. */
  serverProfileId: string | null;
  /** Owner key of the configured sources when no configured server matches it. */
  unresolvedOwnerKey: string | null;
  /** The last listing request against a resolvable server failed. */
  loadFailed: boolean;
  playlists: SubsonicPlaylist[];
  randomAlbums: SubsonicAlbum[];
  albumSearchResults: SubsonicAlbum[];
  albumSearchLoading: boolean;
  artists: SubsonicArtist[];
  loadingBrowser: boolean;
  expandedArtistIds: Set<string>;
  artistAlbumsMap: Map<string, SubsonicAlbum[]>;
  loadingArtistIds: Set<string>;
  toggleArtistExpand: (artistId: string) => Promise<void>;
}

export function useDeviceSyncBrowser(
  activeTab: SourceTab,
  search: string,
  resetSearch: () => void,
): DeviceSyncBrowserResult {
  const activeServerId = useAuthStore(s => s.activeServerId);
  const servers = useAuthStore(s => s.servers);
  const sources = useDeviceSyncStore(s => s.sources);
  const configuredOwner = deviceSyncOwnerKey(sources);
  const unresolvedOwnerKey = deviceSyncUnresolvedOwnerKey(sources, servers);
  // An owner nothing resolves to must not be handed to the API layer as if it
  // were a server id — offer no server at all instead, so nothing new can be
  // added under a dead identity and the panel can say what is wrong.
  const serverIndexKey = unresolvedOwnerKey
    ? null
    : configuredOwner ?? (activeServerId ? resolveStorageServerIndexKey(activeServerId) : null);
  const serverId = serverIndexKey ? resolveServerIdForIndexKey(serverIndexKey) : null;
  // Stamped onto every source the user picks, so the selection survives this
  // server later changing its address.
  const serverProfileId = serverIndexKey
    ? findServerInListByIdOrIndexKey(servers, serverIndexKey)?.id ?? null
    : null;
  const [loadFailed, setLoadFailed] = useState(false);
  const serverIdRef = useRef(serverId);
  useEffect(() => {
    serverIdRef.current = serverId;
  }, [serverId]);

  const [playlists, setPlaylists]           = useState<SubsonicPlaylist[]>([]);
  const [playlistsServerId, setPlaylistsServerId] = useState<string | null>(null);
  const [randomAlbums, setRandomAlbums]     = useState<SubsonicAlbum[]>([]);
  const [randomAlbumsServerId, setRandomAlbumsServerId] = useState<string | null>(null);
  const [albumSearchResults, setAlbumSearchResults] = useState<SubsonicAlbum[]>([]);
  const [albumSearchServerId, setAlbumSearchServerId] = useState<string | null>(null);
  const [albumSearchLoading, setAlbumSearchLoading] = useState(false);
  const [artists, setArtists]               = useState<SubsonicArtist[]>([]);
  const [artistsServerId, setArtistsServerId] = useState<string | null>(null);
  const [loadingBrowser, setLoadingBrowser] = useState(false);
  const [expandedArtistIds, setExpandedArtistIds] = useState<Set<string>>(new Set());
  const [artistAlbumsMap, setArtistAlbumsMap]     = useState<Map<string, SubsonicAlbum[]>>(new Map());
  const [artistAlbumsServerId, setArtistAlbumsServerId] = useState<string | null>(null);
  const [loadingArtistIds, setLoadingArtistIds]   = useState<Set<string>>(new Set());
  const [loadingArtistsServerId, setLoadingArtistsServerId] = useState<string | null>(null);

  const loadPlaylists = useCallback(async () => {
    setLoadingBrowser(true);
    try {
      const result = serverId ? await getPlaylistsForServer(serverId) : [];
      if (serverIdRef.current === serverId) {
        setPlaylists(result);
        setPlaylistsServerId(serverId);
        setLoadFailed(false);
      }
    } catch {
      // A swallowed failure used to render as an ordinary empty list, which is
      // indistinguishable from a server that simply has no playlists.
      if (serverIdRef.current === serverId) setLoadFailed(true);
    }
    finally { if (serverIdRef.current === serverId) setLoadingBrowser(false); }
  }, [serverId]);
  const loadRandomAlbums = useCallback(async () => {
    setLoadingBrowser(true);
    try {
      const result = serverId ? await getAlbumListForServer(serverId, 'random', 10) : [];
      if (serverIdRef.current === serverId) {
        setRandomAlbums(result);
        setRandomAlbumsServerId(serverId);
        setLoadFailed(false);
      }
    } catch {
      if (serverIdRef.current === serverId) setLoadFailed(true);
    }
    finally { if (serverIdRef.current === serverId) setLoadingBrowser(false); }
  }, [serverId]);
  const loadArtists = useCallback(async () => {
    setLoadingBrowser(true);
    try {
      const result = serverId ? await getArtistsForServer(serverId) : [];
      if (serverIdRef.current === serverId) {
        setArtists(result);
        setArtistsServerId(serverId);
        setLoadFailed(false);
      }
    } catch {
      if (serverIdRef.current === serverId) setLoadFailed(true);
    }
    finally { if (serverIdRef.current === serverId) setLoadingBrowser(false); }
  }, [serverId]);

  useEffect(() => {
    resetSearch();
    // React Compiler set-state-in-effect rule: state set from an async result resolved in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeTab === 'playlists') void loadPlaylists();
    if (activeTab === 'albums') void loadRandomAlbums();
    if (activeTab === 'artists') void loadArtists();
  }, [activeTab, loadArtists, loadPlaylists, loadRandomAlbums, resetSearch]);

  // Live album search with 300ms debounce
  useEffect(() => {
    if (activeTab !== 'albums') return;
    const q = search.trim();
    // React Compiler set-state-in-effect rule: state set from a timer/animation callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!q) { setAlbumSearchResults([]); return; }
    setAlbumSearchLoading(true);
    const requestServerId = serverId;
    const timer = setTimeout(async () => {
      try {
        const { albums } = requestServerId
          ? await searchForServer(requestServerId, q, { albumCount: 20, artistCount: 0, songCount: 0 })
          : { albums: [] };
        if (serverIdRef.current === requestServerId) {
          setAlbumSearchResults(albums);
          setAlbumSearchServerId(requestServerId);
        }
      } catch {
        if (serverIdRef.current === requestServerId) {
          setAlbumSearchResults([]);
          setAlbumSearchServerId(requestServerId);
        }
      } finally {
        if (serverIdRef.current === requestServerId) setAlbumSearchLoading(false);
      }
    }, 300);
    return () => { clearTimeout(timer); setAlbumSearchLoading(false); };
  }, [search, activeTab, serverId]);

  const toggleArtistExpand = useCallback(async (artistId: string) => {
    setExpandedArtistIds(prev => {
      const next = artistAlbumsServerId === serverId ? new Set(prev) : new Set<string>();
      if (next.has(artistId)) { next.delete(artistId); return next; }
      next.add(artistId);
      return next;
    });
    if (artistAlbumsServerId !== serverId || !artistAlbumsMap.has(artistId)) {
      setLoadingArtistIds(prev => new Set(prev).add(artistId));
      setLoadingArtistsServerId(serverId);
      const requestServerId = serverId;
      try {
        const { albums } = requestServerId
          ? await getArtistForServer(requestServerId, artistId)
          : { albums: [] };
        if (serverIdRef.current === requestServerId) {
          setArtistAlbumsMap(prev => new Map(
            artistAlbumsServerId === requestServerId ? prev : [],
          ).set(artistId, albums));
          setArtistAlbumsServerId(requestServerId);
        }
      } finally {
        if (serverIdRef.current === requestServerId) {
          setLoadingArtistIds(prev => { const n = new Set(prev); n.delete(artistId); return n; });
        }
      }
    }
  }, [artistAlbumsMap, artistAlbumsServerId, serverId]);

  return {
    serverIndexKey,
    serverProfileId,
    unresolvedOwnerKey,
    loadFailed: loadFailed && serverId != null,
    playlists: playlistsServerId === serverId ? playlists : [],
    randomAlbums: randomAlbumsServerId === serverId ? randomAlbums : [],
    albumSearchResults: albumSearchServerId === serverId ? albumSearchResults : [],
    albumSearchLoading,
    artists: artistsServerId === serverId ? artists : [],
    loadingBrowser,
    expandedArtistIds: artistAlbumsServerId === serverId ? expandedArtistIds : new Set<string>(),
    artistAlbumsMap: artistAlbumsServerId === serverId ? artistAlbumsMap : new Map<string, SubsonicAlbum[]>(),
    loadingArtistIds: loadingArtistsServerId === serverId ? loadingArtistIds : new Set<string>(),
    toggleArtistExpand,
  };
}
