import type { Track } from '@/lib/media/trackTypes';
import { playListFromPosition } from '@/features/playback';
import type { ResumeKind, ResumePoint } from '@/features/resume/store/resumePointsStore';

export type ResumeTrackLoader = (id: string, serverId?: string) => Promise<Track[]>;

/**
 * Track loaders come from the app shell: the album and playlist features show
 * the resume button, so the resume feature cannot import them back.
 */
const loaders: Partial<Record<ResumeKind, ResumeTrackLoader>> = {};

export function registerResumeTrackLoaders(next: Record<ResumeKind, ResumeTrackLoader>): void {
  loaders.album = next.album;
  loaders.playlist = next.playlist;
}

/**
 * Where to start in the list as it is now: the stored slot when the track is
 * still there, else the track's first occurrence. A track that left the list
 * starts its old slot from the beginning, so the position stays meaningful.
 */
export function resumeStartIn(
  tracks: Track[],
  point: Pick<ResumePoint, 'trackId' | 'trackIndex' | 'positionSec'>,
): { index: number; positionSec: number } | null {
  if (tracks.length === 0) return null;
  if (tracks[point.trackIndex]?.id === point.trackId) {
    return { index: point.trackIndex, positionSec: point.positionSec };
  }
  const found = tracks.findIndex(track => track.id === point.trackId);
  if (found >= 0) return { index: found, positionSec: point.positionSec };
  return { index: Math.min(point.trackIndex, tracks.length - 1), positionSec: 0 };
}

/** Load the list again and start it where the point left off. */
export async function resumeFromPoint(point: ResumePoint): Promise<boolean> {
  const load = loaders[point.kind];
  if (!load) return false;
  let tracks: Track[];
  try {
    tracks = await load(point.id, point.serverId);
  } catch {
    return false;
  }
  const start = resumeStartIn(tracks, point);
  if (!start) return false;
  playListFromPosition(tracks, start.index, start.positionSec, {
    kind: point.kind,
    id: point.id,
    serverId: point.serverId,
  });
  return true;
}
