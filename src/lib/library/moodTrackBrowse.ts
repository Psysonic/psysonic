import { libraryListTracksByMood } from '@/lib/api/library';
import {
  libraryScopeForServer,
  libraryScopePairsForServer,
} from '@/lib/api/subsonicClient';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import type { LibraryBrowseScope } from './libraryBrowseScope';
import { readyLibraryServerKeys } from './libraryReady';
import { trackToSong } from './trackDtoMapping';

export const MOOD_TRACK_PAGE_SIZE = 100;

export interface MoodTrackPageResult {
  songs: SubsonicSong[];
  hasMore: boolean;
  total: number | null;
}

const MOOD_TRACK_READINESS_RETRY_DELAY_MS = 250;
const MOOD_TRACK_READINESS_RETRY_LIMIT = 20;

const inflight = new Map<string, Promise<MoodTrackPageResult | null>>();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function waitForMoodTrackLibraryReady(
  serverIds: readonly string[],
): Promise<boolean> {
  if (await readyLibraryServerKeys(serverIds)) return true;

  for (
    let attempt = 0;
    attempt < MOOD_TRACK_READINESS_RETRY_LIMIT;
    attempt += 1
  ) {
    await sleep(MOOD_TRACK_READINESS_RETRY_DELAY_MS);
    if (await readyLibraryServerKeys(serverIds)) return true;
  }

  return false;
}

async function fetchLocalMoodTrackPage(
  serverId: string,
  mood: string,
  offset: number,
  pageSize: number,
  browseScope?: LibraryBrowseScope,
  includeTotal = false,
): Promise<MoodTrackPageResult | null> {
  const scope = browseScope
    ? undefined
    : libraryScopeForServer(serverId) ?? undefined;
  const libraryScopes = browseScope?.pairs.length
    ? browseScope.pairs
    : libraryScopePairsForServer(serverId);
  const serverIds = browseScope?.serverIds.length
    ? browseScope.serverIds
    : [serverId];

  if (!(await waitForMoodTrackLibraryReady(serverIds))) {
    return null;
  }

  const requestKey = JSON.stringify({
    serverId,
    mood,
    offset,
    pageSize,
    scope,
    libraryScopes,
    includeTotal,
  });
  const existing = inflight.get(requestKey);
  if (existing) return existing;

  const request = (async (): Promise<MoodTrackPageResult | null> => {
    try {
      const response = await libraryListTracksByMood({
        serverId,
        mood,
        libraryScope: scope,
        libraryScopes,
        limit: pageSize,
        offset,
        includeTotal,
      });

      if (response.source !== 'local') return null;

      return {
        songs: response.tracks.map(trackToSong),
        hasMore: response.hasMore,
        total: response.total ?? null,
      };
    } catch {
      return null;
    }
  })();

  inflight.set(requestKey, request);

  try {
    return await request;
  } finally {
    if (inflight.get(requestKey) === request) {
      inflight.delete(requestKey);
    }
  }
}

export async function fetchMoodTrackPage(
  serverId: string,
  mood: string,
  indexEnabled: boolean,
  offset: number,
  pageSize = MOOD_TRACK_PAGE_SIZE,
  browseScope?: LibraryBrowseScope,
  includeTotal = false,
): Promise<MoodTrackPageResult | null> {
  if (!serverId || !mood.trim() || !indexEnabled) {
    return null;
  }

  return fetchLocalMoodTrackPage(
    serverId,
    mood,
    offset,
    pageSize,
    browseScope,
    includeTotal,
  );
}