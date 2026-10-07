import { initResumeTracker, type ResumeTrackerDeps } from '@/features/resume/store/resumeTracker';
import { registerResumeTrackLoaders, type ResumeTrackLoader } from '@/features/resume/utils/resumePlayback';

export interface ResumePointsDeps extends ResumeTrackerDeps {
  loadAlbumTracks: ResumeTrackLoader;
  loadPlaylistTracks: ResumeTrackLoader;
}

/** Wired by the app shell, which may reach the album and playlist features. */
export function initResumePoints(deps: ResumePointsDeps): () => void {
  registerResumeTrackLoaders({ album: deps.loadAlbumTracks, playlist: deps.loadPlaylistTracks });
  return initResumeTracker({ playlistName: deps.playlistName });
}
