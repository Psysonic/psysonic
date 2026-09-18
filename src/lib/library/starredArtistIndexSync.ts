import { libraryReconcileArtistStars } from '@/lib/api/library';
import { getStarredForServer } from '@/lib/api/subsonicStarRating';
import type { SubsonicArtist } from '@/lib/api/subsonicTypes';

function parseArtistStarredAtMs(artist: SubsonicArtist): number {
  if (!artist.starred) return Date.now();
  const parsed = Date.parse(artist.starred);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export async function refreshStarredArtistIndexForServer(
  serverId: string,
): Promise<SubsonicArtist[]> {
  const { artists } = await getStarredForServer(serverId);
  return reconcileStarredArtistsForServer(serverId, artists);
}

async function reconcileStarredArtistsForServer(
  serverId: string,
  artists: SubsonicArtist[],
): Promise<SubsonicArtist[]> {
  const mapped = artists.map(artist => ({
    ...artist,
    serverId,
    starred: artist.starred ?? 'true',
  }));
  await libraryReconcileArtistStars({
    serverId,
    starredArtists: mapped.map(artist => ({
      id: artist.id,
      starredAt: parseArtistStarredAtMs(artist),
    })),
  });
  return mapped;
}

export async function refreshStarredArtistIndexes(serverIds: string[]): Promise<void> {
  await Promise.allSettled(serverIds.map(refreshStarredArtistIndexForServer));
}
