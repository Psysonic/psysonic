import { useCallback, useEffect, useRef, useState } from 'react';

import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import type { LibraryBrowseScope } from '@/lib/library/libraryBrowseScope';
import {
  fetchMoodTrackPage,
  MOOD_TRACK_PAGE_SIZE,
} from '@/lib/library/moodTrackBrowse';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

type MoodTrackBrowseCacheEntry = {
  songs: SubsonicSong[];
  hasMore: boolean;
  total: number | null;
};

const MOOD_TRACK_BROWSE_CACHE_MAX = 2;
const moodTrackBrowseCache = new Map<string, MoodTrackBrowseCacheEntry>();

function moodTrackBrowseCacheKey(
  serverId: string,
  mood: string,
  indexEnabled: boolean,
  musicLibraryFilterVersion: number,
  browseScope: LibraryBrowseScope,
): string {
  return JSON.stringify([
    serverId,
    mood.trim().toLowerCase(),
    indexEnabled,
    musicLibraryFilterVersion,
    browseScope.fingerprint,
  ]);
}

function peekMoodTrackBrowseCache(
  key: string,
): MoodTrackBrowseCacheEntry | null {
  return moodTrackBrowseCache.get(key) ?? null;
}

function readMoodTrackBrowseCache(
  key: string,
): MoodTrackBrowseCacheEntry | null {
  const cached = moodTrackBrowseCache.get(key);
  if (!cached) return null;

  // Promote on an actual restore/read so the cache stays bounded to the most
  // recently revisited mood track sessions.
  moodTrackBrowseCache.delete(key);
  moodTrackBrowseCache.set(key, cached);
  return cached;
}

function writeMoodTrackBrowseCache(
  key: string,
  entry: MoodTrackBrowseCacheEntry,
): void {
  moodTrackBrowseCache.delete(key);
  moodTrackBrowseCache.set(key, entry);

  while (moodTrackBrowseCache.size > MOOD_TRACK_BROWSE_CACHE_MAX) {
    const oldestKey = moodTrackBrowseCache.keys().next().value;
    if (oldestKey == null) break;
    moodTrackBrowseCache.delete(oldestKey);
  }
}

export function useMoodTrackBrowse(
  serverId: string,
  mood: string,
  indexEnabled: boolean,
  enabled: boolean,
  musicLibraryFilterVersion: number,
  browseScope: LibraryBrowseScope,
) {
  const cacheKey = moodTrackBrowseCacheKey(
    serverId,
    mood,
    indexEnabled,
    musicLibraryFilterVersion,
    browseScope,
  );
  const cachedForKey = peekMoodTrackBrowseCache(cacheKey);
  const initialCached = enabled ? cachedForKey : null;

  const [songs, setSongs] = useState<SubsonicSong[]>(
    () => initialCached?.songs ?? [],
  );
  const [total, setTotal] = useState<number | null>(
    () => cachedForKey?.total ?? null,
  );
  const [loading, setLoading] = useState(
    () =>
      enabled &&
      !!serverId &&
      !!mood.trim() &&
      indexEnabled &&
      !initialCached,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(
    () => initialCached?.hasMore ?? false,
  );

  const generationRef = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;

    if (!enabled || !serverId || !mood.trim() || !indexEnabled) {
      // React Compiler set-state-in-effect rule: reset state for an inactive route/view.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSongs([]);
      setHasMore(false);
      setTotal(peekMoodTrackBrowseCache(cacheKey)?.total ?? null);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    const cached =
      readMoodTrackBrowseCache(cacheKey);

    if (cached) {
      setSongs(cached.songs);
      setHasMore(cached.hasMore);
      setTotal(cached.total);
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      return () => {
        generationRef.current += 1;
      };
    }

    setSongs([]);
    setHasMore(false);
    setTotal(null);
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;

    void fetchMoodTrackPage(
      serverId,
      mood,
      indexEnabled,
      0,
      MOOD_TRACK_PAGE_SIZE,
      browseScope,
      true,
    ).then(page => {
      if (generation !== generationRef.current) return;
      setSongs(page.songs);
      setHasMore(page.hasMore);
      setTotal(page.total);
      writeMoodTrackBrowseCache(
        cacheKey,
        {
          songs: page.songs,
          hasMore: page.hasMore,
          total: page.total,
        },
      );
      setLoading(false);
    });

    return () => {
      generationRef.current += 1;
    };
  }, [
    serverId,
    mood,
    indexEnabled,
    enabled,
    musicLibraryFilterVersion,
    browseScope,
    cacheKey,
  ]);

  const loadMore = useCallback(() => {
    if (
      !enabled ||
      loadingMoreRef.current ||
      !hasMore ||
      !serverId ||
      !mood.trim()
    ) {
      return;
    }

    const generation = generationRef.current;
    const offset = songs.length;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    void fetchMoodTrackPage(
      serverId,
      mood,
      indexEnabled,
      offset,
      MOOD_TRACK_PAGE_SIZE,
      browseScope,
      false,
    ).then(page => {
      if (generation !== generationRef.current) return;
      setSongs(previous => {
        const merged = [...previous, ...page.songs];
        const seen = new Set<string>();
        const deduped = merged.filter(song => {
          const key = ownedEntityKey(song);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        writeMoodTrackBrowseCache(
          cacheKey,
          {
            songs: deduped,
            hasMore: page.hasMore,
            total,
          },
        );

        return deduped;
      });
      setHasMore(page.hasMore);
    }).finally(() => {
      if (generation === generationRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    });
  }, [
    enabled,
    hasMore,
    serverId,
    mood,
    songs.length,
    indexEnabled,
    browseScope,
    cacheKey,
    total,
  ]);

  return {
    songs,
    total,
    loading,
    loadingMore,
    hasMore,
    loadMore,
  };
}
