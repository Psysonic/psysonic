import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { makeTrack } from '@/test/helpers/factories';
import { onInvoke } from '@/test/mocks/tauri';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { usePrivateModeStore } from '@/features/privateMode';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { emitPlaybackSeek } from '@/features/playback/store/playbackProgress';

vi.mock('@/cover/integrations/discord', () => ({
  resolveCoverForDiscord: vi.fn(async () => null),
}));

import { setupDiscordPresence } from './discordPresence';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const presenceCalls = (cmd: string) =>
  vi.mocked(invoke).mock.calls.filter(([name]) => name === cmd).length;

let stop: (() => void) | null = null;

beforeEach(() => {
  resetAllStores();
  vi.mocked(invoke).mockClear();
  onInvoke('discord_update_presence', () => undefined);
  onInvoke('discord_clear_presence', () => undefined);
  useAuthStore.setState({ discordRichPresence: true, discordCoverSource: 'none' });
  stop = setupDiscordPresence();
});

afterEach(() => {
  stop?.();
  stop = null;
});

describe('Discord presence progress', () => {
  it('passes the track duration in seconds so Discord can draw a progress bar', async () => {
    usePlayerStore.setState({ currentTrack: makeTrack({ duration: 240 }), isPlaying: true });
    await flush();
    const call = vi.mocked(invoke).mock.calls.find(([name]) => name === 'discord_update_presence');
    expect(call?.[1]).toMatchObject({ durationSecs: 240 });
  });
});

describe('Discord presence seek', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('republishes the seeked position without resolving the cover again (debounced)', async () => {
    const { resolveCoverForDiscord } = await import('@/cover/integrations/discord');
    usePlayerStore.setState({ currentTrack: makeTrack({ duration: 240 }), isPlaying: true });
    await flush();
    expect(vi.mocked(resolveCoverForDiscord)).toHaveBeenCalledTimes(1);

    // emitPlaybackSeek alone must convey the new position (proves seek event isn't relying on emitPlaybackProgress)
    emitPlaybackSeek(90);
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'discord_update_presence')).toHaveLength(1);

    vi.advanceTimersByTime(300);
    await flush();

    const calls = vi.mocked(invoke).mock.calls.filter(([name]) => name === 'discord_update_presence');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[1]).toMatchObject({ elapsedSecs: 90, durationSecs: 240 });
    expect(vi.mocked(resolveCoverForDiscord)).toHaveBeenCalledTimes(1);
  });

  it('waits out a cover lookup instead of publishing a seek with no image', async () => {
    let release: (url: string | null) => void = () => {};
    const { resolveCoverForDiscord } = await import('@/cover/integrations/discord');
    vi.mocked(resolveCoverForDiscord).mockImplementationOnce(
      () => new Promise(resolve => { release = resolve; }),
    );
    usePlayerStore.setState({ currentTrack: makeTrack({ duration: 240 }), isPlaying: true });
    await flush();
    expect(presenceCalls('discord_update_presence')).toBe(0);

    emitPlaybackSeek(90);
    vi.advanceTimersByTime(300);
    await flush();
    expect(presenceCalls('discord_update_presence')).toBe(0);

    release('https://cdn.example/cover.jpg');
    await flush();
    const call = vi.mocked(invoke).mock.calls.find(([name]) => name === 'discord_update_presence');
    expect(call?.[1]).toMatchObject({
      elapsedSecs: 0,
      durationSecs: 240,
      coverArtUrl: 'https://cdn.example/cover.jpg',
    });
    expect(vi.mocked(resolveCoverForDiscord)).toHaveBeenCalledTimes(1);
  });

  it('does not republish a seek while paused', async () => {
    usePlayerStore.setState({ currentTrack: makeTrack(), isPlaying: false });
    await flush();
    const before = presenceCalls('discord_update_presence');

    emitPlaybackSeek(40);
    vi.advanceTimersByTime(300);
    await flush();

    expect(presenceCalls('discord_update_presence')).toBe(before);
  });

  it('does not publish a stale seek position if track changes before debounce expires', async () => {
    const trackA = makeTrack({ id: 'track-a', title: 'Track A', duration: 240 });
    const trackB = makeTrack({ id: 'track-b', title: 'Track B', duration: 180 });

    usePlayerStore.setState({ currentTrack: trackA, isPlaying: true });
    await flush();

    // User seeks to 200s on track A
    emitPlaybackSeek(200);

    // Immediately switches to track B before 300ms debounce fires
    usePlayerStore.setState({ currentTrack: trackB, isPlaying: true });
    await flush();

    // Advance past the 300ms seek debounce timer
    vi.advanceTimersByTime(350);
    await flush();

    // Verify no presence update was published for Track B with Track A's 200s seek position
    const calls = vi.mocked(invoke).mock.calls.filter(([name]) => name === 'discord_update_presence');
    const staleSeekCall = calls.find(
      ([, payload]) =>
        payload &&
        typeof payload === 'object' &&
        'title' in payload &&
        (payload as { title?: string }).title === 'Track B' &&
        'elapsedSecs' in payload &&
        (payload as { elapsedSecs?: number }).elapsedSecs === 200,
    );
    expect(staleSeekCall).toBeUndefined();
  });
});

describe('Discord presence in private mode', () => {
  it('publishes nothing for a track that starts while private mode is on', async () => {
    usePrivateModeStore.setState({ active: true });
    usePlayerStore.setState({ currentTrack: makeTrack(), isPlaying: true });
    await flush();
    expect(presenceCalls('discord_update_presence')).toBe(0);
  });

  it('clears the presence when private mode turns on and restores it when it turns off', async () => {
    usePlayerStore.setState({ currentTrack: makeTrack(), isPlaying: true });
    await flush();
    expect(presenceCalls('discord_update_presence')).toBe(1);

    usePrivateModeStore.setState({ active: true });
    await flush();
    expect(presenceCalls('discord_clear_presence')).toBe(1);

    usePrivateModeStore.setState({ active: false });
    await flush();
    expect(presenceCalls('discord_update_presence')).toBe(2);
  });
});
