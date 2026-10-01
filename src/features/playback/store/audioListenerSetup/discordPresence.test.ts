import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { makeTrack } from '@/test/helpers/factories';
import { onInvoke } from '@/test/mocks/tauri';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { usePrivateModeStore } from '@/features/privateMode';
import { usePlayerStore } from '@/features/playback/store/playerStore';

vi.mock('@/cover/integrations/discord', () => ({
  resolveCoverForDiscord: vi.fn(async () => null),
}));

import { setupDiscordPresence } from './discordPresence';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
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
