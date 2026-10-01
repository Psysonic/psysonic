import { usePrivateModeStore } from '@/features/privateMode';
import { playbackReportStopped } from '@/features/playback/store/playbackReportSession';

/**
 * Switching private mode on mid-track withdraws the server's live now-playing
 * entry right away instead of leaving it up until the track ends. Switching it
 * off resumes reporting with the next track. Returns a cleanup function.
 */
export function setupPrivateModePresence(): () => void {
  return usePrivateModeStore.subscribe((state, prev) => {
    if (state.active && !prev.active) void playbackReportStopped();
  });
}
