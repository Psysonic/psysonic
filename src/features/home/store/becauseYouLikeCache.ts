import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';

export type BecauseYouLikeAnchor = {
  id: string;
  name: string;
  serverId: string;
  /** Album that put this artist into the pool; seeds the AudioMuse lookup. */
  seedAlbumId?: string;
  /** Set when the cards shown for this anchor came from AudioMuse sonic matches. */
  bySound?: true;
};

export type BecauseYouLikeSnapshot = {
  scopeKey: string;
  scopeVersion: number;
  savedAt: number;
  anchor: BecauseYouLikeAnchor;
  recs: SubsonicAlbum[];
};

const TTL_MS = 15 * 60 * 1000;
let snapshot: BecauseYouLikeSnapshot | null = null;

export function readBecauseYouLikeCache(
  scopeKey: string | null | undefined,
  scopeVersion: number,
): BecauseYouLikeSnapshot | null {
  if (!scopeKey || !snapshot) return null;
  if (snapshot.scopeKey !== scopeKey || snapshot.scopeVersion !== scopeVersion) return null;
  if (Date.now() - snapshot.savedAt > TTL_MS) return null;
  return snapshot;
}

export function writeBecauseYouLikeCache(
  data: Omit<BecauseYouLikeSnapshot, 'savedAt'>,
): void {
  snapshot = { ...data, savedAt: Date.now() };
}

export function clearBecauseYouLikeCache(): void {
  snapshot = null;
}
