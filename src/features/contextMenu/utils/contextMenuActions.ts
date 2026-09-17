import { join } from '@tauri-apps/api/path';
import { downloadZip } from '@/lib/api/downloadZip';
import {
  fetchSimilarTracksRoutedForServer,
  getSimilarSongs2ForServer,
  getTopSongsForServer,
} from '@/lib/api/subsonicArtists';
import { filterSongsForLuckyMixRatings, getMixMinRatingsConfigFromAuth } from '@/features/playback/utils/mixRatingFilter';
import { buildDownloadUrlForServer } from '@/lib/api/subsonicStreamUrl';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import type { Track } from '@/lib/media/trackTypes';
import { resolveQueueTrack } from '@/features/playback/store/queueTrackView';
import { useZipDownloadStore } from '@/features/offline';
import { useDownloadModalStore } from '@/features/offline';
import { sanitizeFilename, shuffleArray } from '@/features/contextMenu/utils/contextMenuHelpers';
import { songToTrack } from '@/lib/media/songToTrack';
import { showToast } from '@/lib/dom/toast';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

let contextRadioGeneration = 0;

export async function startRadio(
  artistId: string,
  artistName: string,
  playTrack: (track: Track, queue: Track[]) => void,
  seedTrack?: Track,
  serverId?: string,
) {
  const ownerServerId = seedTrack?.serverId ?? serverId ?? useAuthStore.getState().activeServerId;
  if (!ownerServerId) return;
  const generation = ++contextRadioGeneration;
  if (seedTrack) {
    const state = usePlayerStore.getState();
    if (state.currentTrack && ownedEntityKey(state.currentTrack) === ownedEntityKey(seedTrack)) {
      if (!state.isPlaying) state.resume();
    } else {
      playTrack(seedTrack, [seedTrack]);
    }
    try {
      const [similar, top] = await Promise.all([
        getSimilarSongs2ForServer(ownerServerId, artistId),
        getTopSongsForServer(ownerServerId, artistName),
      ]);
      if (generation !== contextRadioGeneration) return;
      const similarTracks = shuffleArray(
        similar.map(songToTrack).filter(t => t.id !== seedTrack.id).map(t => ({ ...t, radioAdded: true as const })),
      );
      const radioTracks = similarTracks.length > 0
        ? similarTracks
        : shuffleArray(
            top.map(songToTrack).filter(t => t.id !== seedTrack.id).map(t => ({ ...t, radioAdded: true as const })),
          );
      if (radioTracks.length > 0) usePlayerStore.getState().enqueueRadio(radioTracks, artistId, ownerServerId);
    } catch (e) {
      console.error('Failed to load radio queue', e);
    }
    return;
  }

  // Artist radio without seed
  const similarPromise = getSimilarSongs2ForServer(ownerServerId, artistId)
    .catch(() => [] as Awaited<ReturnType<typeof getSimilarSongs2ForServer>>);
  try {
    const top = await getTopSongsForServer(ownerServerId, artistName);
    if (generation !== contextRadioGeneration) return;
    const topTracks = shuffleArray(
      top.map(t => ({ ...songToTrack(t), radioAdded: true as const })),
    );
    if (topTracks.length === 0) {
      const similar = await similarPromise;
      if (generation !== contextRadioGeneration) return;
      const fallback = shuffleArray(
        similar.map(t => ({ ...songToTrack(t), radioAdded: true as const })),
      );
      if (fallback.length === 0) return;
      const state = usePlayerStore.getState();
      if (state.currentTrack) {
        state.enqueueRadio(fallback, artistId, ownerServerId);
      } else {
        state.setRadioArtistId(artistId, ownerServerId);
        playTrack(fallback[0], fallback);
      }
      return;
    }
    const state = usePlayerStore.getState();
    if (state.currentTrack) {
      state.enqueueRadio([topTracks[0]], artistId, ownerServerId);
    } else {
      state.setRadioArtistId(artistId, ownerServerId);
      playTrack(topTracks[0], [topTracks[0]]);
    }
    similarPromise.then(similar => {
      if (generation !== contextRadioGeneration) return;
      const similarTracks = shuffleArray(
        similar
          .map(t => ({ ...songToTrack(t), radioAdded: true as const }))
          .filter(t => t.id !== topTracks[0].id),
      );
      if (similarTracks.length === 0) return;
      const { queueItems, queueIndex } = usePlayerStore.getState();
      // Thin-state: resolve the upcoming radio refs (cache-warm window) back to
      // Tracks so they merge with the new similars in enqueueRadio.
      const pendingRadio = queueItems
        .slice(queueIndex + 1)
        .filter(r => r.radioAdded)
        .map(r => resolveQueueTrack(r));
      usePlayerStore.getState().enqueueRadio([...pendingRadio, ...similarTracks], artistId, ownerServerId);
    });
  } catch (e) {
    console.error('Failed to start radio', e);
  }
}

export async function startInstantMix(
  song: Track,
  t: (key: string) => string,
) {
  contextRadioGeneration += 1;
  usePlayerStore.getState().reseedQueueForInstantMix(song);
  const serverId = song.serverId ?? useAuthStore.getState().activeServerId;
  if (!serverId) return;
  try {
    const similar = await fetchSimilarTracksRoutedForServer(serverId, song.id, 50);
    useAuthStore.getState().setAudiomuseNavidromeIssue(serverId, false);
    const mixCfg = getMixMinRatingsConfigFromAuth();
    const ratedFiltered = await filterSongsForLuckyMixRatings(
      similar.filter(s => s.id !== song.id),
      mixCfg,
    );
    const shuffled = shuffleArray(
      ratedFiltered.map(s => ({ ...songToTrack(s), radioAdded: true as const })),
    );
    if (shuffled.length > 0) {
      const aid = song.artistId?.trim() || undefined;
      usePlayerStore.getState().enqueueRadio(shuffled, aid, serverId);
    }
  } catch (e) {
    console.error('Instant mix failed', e);
    useAuthStore.getState().setAudiomuseNavidromeIssue(serverId, true);
    showToast(t('contextMenu.instantMixFailed'), 5000, 'error');
  }
}

export async function downloadAlbum(albumName: string, albumId: string, serverId?: string) {
  const auth = useAuthStore.getState();
  const requestDownloadFolder = useDownloadModalStore.getState().requestFolder;
  const folder = auth.downloadFolder || await requestDownloadFolder();
  if (!folder) return;

  const filename = `${sanitizeFilename(albumName)}.zip`;
  const destPath = await join(folder, filename);
  const ownerServerId = serverId ?? auth.activeServerId;
  if (!ownerServerId) return;
  const url = buildDownloadUrlForServer(ownerServerId, albumId);
  const id = crypto.randomUUID();

  const { start, complete, fail } = useZipDownloadStore.getState();
  start(id, filename);
  try {
    await downloadZip({ id, url, destPath });
    complete(id);
  } catch (e) {
    fail(id);
    console.error('ZIP download failed:', e);
  }
}
