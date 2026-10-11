import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/library', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api/library')>()),
  libraryGetTracksBatchChunked: vi.fn(),
}));

import { libraryGetTracksBatchChunked, type LibraryTrackDto, type PlaySessionDayTrack } from '@/lib/api/library';
import { useExplicitDayTrackKeys } from '@/features/stats/hooks/useExplicitDayTrackKeys';
import { useThemeStore } from '@/store/themeStore';

const play = (trackId: string, startedAtMs = 1): PlaySessionDayTrack => ({
  serverId: 's1', trackId, title: trackId, artist: null, listenedSec: 60, completion: 'full', startedAtMs,
});

const dto = (id: string, explicitStatus?: string) =>
  ({ serverId: 's1', id, rawJson: explicitStatus ? { explicitStatus } : {} }) as unknown as LibraryTrackDto;

describe('useExplicitDayTrackKeys', () => {
  beforeEach(() => {
    useThemeStore.setState({ showExplicitBadges: true });
    vi.mocked(libraryGetTracksBatchChunked).mockResolvedValue([dto('t1', 'explicit'), dto('t2', 'clean')]);
  });

  afterEach(() => {
    vi.mocked(libraryGetTracksBatchChunked).mockClear();
  });

  it('reads nothing while the badges are off', () => {
    useThemeStore.setState({ showExplicitBadges: false });
    const tracks = [play('t1')];
    const { result } = renderHook(() => useExplicitDayTrackKeys(tracks));
    expect(result.current.size).toBe(0);
    expect(libraryGetTracksBatchChunked).not.toHaveBeenCalled();
  });

  it('looks each played track up once and keeps the explicit ones', async () => {
    const tracks = [play('t1', 1), play('t1', 2), play('t2')];
    const { result } = renderHook(() => useExplicitDayTrackKeys(tracks));

    await waitFor(() => expect(result.current.has('s1:t1')).toBe(true));
    expect(result.current.has('s1:t2')).toBe(false);
    expect(libraryGetTracksBatchChunked).toHaveBeenCalledWith([
      { serverId: 's1', trackId: 't1' },
      { serverId: 's1', trackId: 't2' },
    ]);
  });
});
