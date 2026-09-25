import { useEffect, useMemo, useState } from 'react';
import { getSonicSimilarMatchesForServer } from '@/lib/api/subsonicArtists';
import type { SubsonicAlbum, SubsonicSong } from '@/lib/api/subsonicTypes';
import { shouldAttemptSubsonicForServer } from '@/lib/network/subsonicNetworkGuard';
import { isSonicSimilarityActiveForServer } from '@/lib/serverCapabilities/storeView';
import { useAuthStore } from '@/store/authStore';
import { aggregateSimilarAlbums, pickSimilarSeeds } from '@/features/album/utils/aggregateSimilarAlbums';

const SIMILAR_TRACKS_PER_SEED = 40;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 32;

const cache = new Map<string, { albums: SubsonicAlbum[]; savedAt: number }>();

function readCache(key: string): SubsonicAlbum[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.albums;
}

function writeCache(key: string, albums: SubsonicAlbum[]): void {
  cache.delete(key);
  cache.set(key, { albums, savedAt: Date.now() });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

export function resetAlbumSimilarAlbumsCacheForTests(): void {
  cache.clear();
}

export interface AlbumSimilarAlbumsInput {
  serverId: string;
  albumId: string;
  /** Album artist of the current album; their albums are excluded. */
  artistId?: string;
  songs: readonly SubsonicSong[];
  /** Page-level switch (offline browse etc.); the AudioMuse gate is applied here. */
  enabled: boolean;
}

export interface AlbumSimilarAlbumsResult {
  albums: SubsonicAlbum[];
  loading: boolean;
}

/**
 * Sonically similar albums for the album page, built from AudioMuse
 * `getSonicSimilarTracks` on a few seed tracks, ranked by similarity score. Only runs when the server's
 * similarity comes from the sonic strategy — never the legacy
 * `getSimilarSongs` path, which Navidrome may answer from Last.fm.
 */
export function useAlbumSimilarAlbums({
  serverId,
  albumId,
  artistId,
  songs,
  enabled,
}: AlbumSimilarAlbumsInput): AlbumSimilarAlbumsResult {
  // Subscribed so the rail appears once the capability probe settles.
  const identity = useAuthStore(s => s.subsonicServerIdentityByServer[serverId]);
  const pluginProbe = useAuthStore(s => s.audiomusePluginProbeByServer[serverId]);
  const extensions = useAuthStore(s => s.openSubsonicExtensionsByServer[serverId]);
  const musicLibraryFilterVersion = useAuthStore(s => s.musicLibraryFilterVersion);
  const sonicActive = useMemo(
    () => !!serverId && isSonicSimilarityActiveForServer(serverId),
    // The selector reads the store directly; these are the fields it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverId, identity, pluginProbe, extensions],
  );

  const seedIds = useMemo(() => pickSimilarSeeds(songs).map(s => s.id), [songs]);
  const seedKey = seedIds.join(',');
  const wanted = enabled && sonicActive && !!albumId && seedIds.length > 0;
  const cacheKey = `${serverId}:${albumId}:${musicLibraryFilterVersion}`;

  const [result, setResult] = useState<{ key: string; albums: SubsonicAlbum[]; settled: boolean } | null>(null);

  useEffect(() => {
    if (!wanted) return;
    const cached = readCache(cacheKey);
    if (cached) {
      // React Compiler set-state-in-effect rule: cache hit resolved synchronously in this effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult({ key: cacheKey, albums: cached, settled: true });
      return;
    }
    if (!shouldAttemptSubsonicForServer(serverId)) return;
    let cancelled = false;
    setResult({ key: cacheKey, albums: [], settled: false });
    void Promise.allSettled(
      seedKey.split(',').map(id => getSonicSimilarMatchesForServer(serverId, id, SIMILAR_TRACKS_PER_SEED)),
    ).then(outcomes => {
      if (cancelled) return;
      const matches = outcomes.flatMap(o => (o.status === 'fulfilled' ? o.value : []));
      const albums = aggregateSimilarAlbums(matches, albumId, artistId);
      // Only cache when some lookup succeeded, so a transient failure retries on the next visit.
      if (outcomes.some(o => o.status === 'fulfilled' && o.value.length > 0)) writeCache(cacheKey, albums);
      setResult({ key: cacheKey, albums, settled: true });
    });
    return () => { cancelled = true; };
  }, [wanted, cacheKey, serverId, albumId, artistId, seedKey]);

  const current = wanted && result?.key === cacheKey ? result : null;
  return {
    albums: current?.settled ? current.albums : [],
    loading: !!current && !current.settled,
  };
}
