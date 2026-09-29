import { aggregateSimilarAlbums, pickSimilarSeeds } from '@/features/album';
import { resolveAlbum } from '@/features/offline';
import { getSonicSimilarMatchesForServer } from '@/lib/api/subsonicArtists';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { shouldAttemptSubsonicForServer } from '@/lib/network/subsonicNetworkGuard';
import { isSonicSimilarityActiveForServer } from '@/lib/serverCapabilities/storeView';
import type { BecauseYouLikeAnchor } from '@/features/home/store/becauseYouLikeCache';

const SONIC_TRACKS_PER_SEED = 40;

/**
 * Albums for one "Because you listened" anchor from AudioMuse sonic matches,
 * seeded with tracks of the album that put the anchor artist into the pool.
 * Returns `null` whenever this path cannot answer (no sonic similarity on the
 * anchor's server, no seed album, nothing matched) so the caller falls back to
 * similar artists.
 *
 * Picks prefer albums not shown recently and one album per artist, so a single
 * artist with many close matches cannot fill the whole rail.
 */
export async function resolveSonicPicks(
  anchor: BecauseYouLikeAnchor,
  recentPicks: ReadonlySet<string>,
  count: number,
): Promise<SubsonicAlbum[] | null> {
  const { serverId, seedAlbumId } = anchor;
  if (!seedAlbumId || !isSonicSimilarityActiveForServer(serverId)) return null;
  if (!shouldAttemptSubsonicForServer(serverId)) return null;

  const seedAlbum = await resolveAlbum(serverId, seedAlbumId);
  const seeds = pickSimilarSeeds(seedAlbum?.songs ?? []);
  if (seeds.length === 0) return null;

  const outcomes = await Promise.allSettled(
    seeds.map(seed => getSonicSimilarMatchesForServer(serverId, seed.id, SONIC_TRACKS_PER_SEED)),
  );
  const matches = outcomes.flatMap(o => (o.status === 'fulfilled' ? o.value : []));
  const ranked = aggregateSimilarAlbums(matches, seedAlbumId, anchor.id)
    .map(album => ({ ...album, serverId: album.serverId ?? serverId }));
  if (ranked.length === 0) return null;

  const isRecent = (album: SubsonicAlbum) => recentPicks.has(`${serverId}:${album.id}`);
  const picks: SubsonicAlbum[] = [];
  const artists = new Set<string>();
  const take = (album: SubsonicAlbum, distinctArtist: boolean) => {
    if (picks.length >= count || picks.includes(album)) return;
    const artistKey = album.artistId || album.artist;
    if (distinctArtist && artists.has(artistKey)) return;
    artists.add(artistKey);
    picks.push(album);
  };
  for (const album of ranked) if (!isRecent(album)) take(album, true);
  for (const album of ranked) if (!isRecent(album)) take(album, false);
  for (const album of ranked) take(album, false);
  return picks;
}
