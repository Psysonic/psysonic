import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { resetPlayerStore } from '@/test/helpers/storeReset';
import { makeTrack } from '@/test/helpers/factories';
import { getGaplessPreloadingId, setGaplessPreloadingId } from '@/features/playback/store/gaplessPreloadState';
import { audioInvalidatePreloads } from '@/lib/api/audio';
import { invalidateNativePreloads } from '@/features/playback/store/playbackEngineBridgeRegister';

vi.mock('@/lib/api/audio', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api/audio')>()),
  audioInvalidatePreloads: vi.fn(async () => undefined),
}));

describe('repeat-mode preload invalidation', () => {
  beforeEach(async () => {
    resetPlayerStore();
    await invalidateNativePreloads();
    vi.mocked(audioInvalidatePreloads).mockClear();
  });

  it.each(['toggle', 'direct'] as const)('cancels the queued source after a %s mode change without restarting playback', async change => {
    const track = makeTrack();
    usePlayerStore.setState({ currentTrack: track, isPlaying: true, currentTime: 80, enginePreloadedTrackId: track.id });
    setGaplessPreloadingId(track.id);
    if (change === 'toggle') usePlayerStore.getState().toggleRepeat();
    else usePlayerStore.setState({ repeatMode: 'one' });
    await vi.waitFor(() => {
      expect(audioInvalidatePreloads).toHaveBeenCalledTimes(1);
      expect(getGaplessPreloadingId()).toBeNull();
      expect(usePlayerStore.getState().enginePreloadedTrackId).toBeNull();
    });
    expect(usePlayerStore.getState().currentTrack).toBe(track);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().currentTime).toBe(80);
  });

  it('does not invalidate preloads on an ordinary progress update', async () => {
    usePlayerStore.setState({ currentTime: 81 });
    await Promise.resolve();
    expect(audioInvalidatePreloads).not.toHaveBeenCalled();
  });
});
