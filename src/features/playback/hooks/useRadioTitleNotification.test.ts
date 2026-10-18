import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  announce: vi.fn(),
}));

vi.mock('@/features/playback/utils/notifications/trackNotificationScheduler', () => ({
  trackNotificationScheduler: { announce: hoisted.announce, dispose: vi.fn() },
}));
vi.mock('@/cover/integrations/notification', () => ({
  coverArtPathForNotification: vi.fn(() => Promise.resolve('/cover-cache/ra-station/256.webp')),
}));

import { useRadioTitleNotification } from './useRadioTitleNotification';
import type { RadioMetadata } from '@/features/radio';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import type { InternetRadioStation } from '@/lib/api/subsonicTypes';
import { resetPlayerStore } from '@/test/helpers/storeReset';

const station: InternetRadioStation = {
  id: 'station',
  serverId: 'srv',
  name: 'Station',
  streamUrl: 'https://radio.test/live',
  coverArt: 'ra-station',
};

function meta(currentTitle?: string, currentArtist?: string): RadioMetadata {
  return { source: currentTitle ? 'icy' : 'none', currentTitle, currentArtist } as RadioMetadata;
}

beforeEach(() => {
  resetPlayerStore();
  hoisted.announce.mockReset();
});

describe('useRadioTitleNotification', () => {
  it('stays silent until the stream reports a title', () => {
    renderHook(() => useRadioTitleNotification(meta(), station));
    expect(hoisted.announce).not.toHaveBeenCalled();
  });

  it('announces each new stream title with the station and its logo', async () => {
    usePlayerStore.setState({ isPlaying: true });
    const { rerender } = renderHook(
      ({ radioMeta }) => useRadioTitleNotification(radioMeta, station),
      { initialProps: { radioMeta: meta('Song', 'Band') } },
    );

    expect(hoisted.announce).toHaveBeenCalledTimes(1);
    const [key, build, isCurrent] = hoisted.announce.mock.calls[0];
    expect(key).toBe('radio:srv:station|Band|Song');
    await expect(build()).resolves.toEqual({
      title: 'Song',
      body: 'Band\nStation',
      coverPath: '/cover-cache/ra-station/256.webp',
    });
    expect(isCurrent()).toBe(true);

    rerender({ radioMeta: meta('Next song', 'Band') });
    expect(hoisted.announce).toHaveBeenCalledTimes(2);
    expect(isCurrent()).toBe(false);
  });

  it('treats a paused stream as no longer current', () => {
    usePlayerStore.setState({ isPlaying: true });
    renderHook(() => useRadioTitleNotification(meta('Song'), station));
    const isCurrent = hoisted.announce.mock.calls[0][2];

    usePlayerStore.setState({ isPlaying: false });
    expect(isCurrent()).toBe(false);
  });
});
