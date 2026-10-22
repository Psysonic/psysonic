import type { Track } from '@/lib/media/trackTypes';
import { shuffleTracks, withQueueSource } from '@/features/playback';

// No `touchPlaylist` here: playing/shuffling/enqueuing does not modify the
// playlist. Touching it bumps `lastModified`, which is the playlist detail
// page's load-effect trigger, so it would re-fetch and flash the whole
// container on every Play click. Real mutations (add/remove/save) still touch.
export interface BulkPlayDeps {
  songsLength: number;
  id: string | undefined;
  serverId?: string;
  tracks: Track[];
  playTrack: (track: Track, queue: Track[]) => void;
  enqueue: (tracks: Track[]) => void;
}

export function playPlaylistAll(deps: BulkPlayDeps): void {
  const { songsLength, id, serverId, tracks, playTrack } = deps;
  if (!songsLength || !id) return;
  withQueueSource({ kind: 'playlist', id, serverId }, () => playTrack(tracks[0], tracks));
}

export function shufflePlaylistAll(deps: BulkPlayDeps): void {
  const { songsLength, id, serverId, tracks, playTrack } = deps;
  if (!songsLength || !id) return;
  const shuffled = shuffleTracks(tracks);
  withQueueSource({ kind: 'playlist', id, serverId, shuffled: true }, () => playTrack(shuffled[0], shuffled));
}

export function enqueuePlaylistAll(deps: BulkPlayDeps): void {
  const { songsLength, id, tracks, enqueue } = deps;
  if (!songsLength || !id) return;
  enqueue(tracks);
}
