import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeInitialOrbitState } from '@/features/orbit/api/orbit';
import { useOrbitStore } from '@/features/orbit/store/orbitStore';
import { useAuthStore } from '@/store/authStore';
import { suggestOrbitTracks } from './guest';

const mocks = vi.hoisted(() => ({
  log: [] as string[],
  outbox: [] as string[],
  showToast: vi.fn(),
}));

vi.mock('@/lib/api/subsonicPlaylists', () => ({
  getPlaylistsForServer: vi.fn(),
  createPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  getPlaylistForServer: vi.fn(async () => {
    mocks.log.push(`read:${mocks.outbox.join('+')}`);
    return { songs: mocks.outbox.map(id => ({ id })) };
  }),
  addSongsToPlaylist: vi.fn(async (_playlistId: string, ids: string[]) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    mocks.outbox.push(...ids);
    mocks.log.push(`add:${ids.join('+')}`);
  }),
}));
vi.mock('@/lib/dom/toast', () => ({ showToast: mocks.showToast }));

function joinAsGuest(suggestionBlocked: string[] = []) {
  const state = { ...makeInitialOrbitState({ sid: 'sess', host: 'host', name: 'Room' }), suggestionBlocked };
  useOrbitStore.setState({
    role: 'guest',
    phase: 'active',
    serverId: 'srv',
    sessionId: 'sess',
    sessionPlaylistId: 'session-pl',
    outboxPlaylistId: 'outbox-pl',
    state,
    pendingSuggestions: [],
  });
}

describe('suggestOrbitTracks', () => {
  beforeEach(() => {
    mocks.log = [];
    mocks.outbox = [];
    mocks.showToast.mockClear();
    useAuthStore.setState({ activeServerId: 'srv', servers: [{ id: 'srv', username: 'guest', name: 'Home', url: 'http://srv', password: '' }] as never });
  });

  it('suggests the tracks one after another and confirms once', async () => {
    joinAsGuest();
    await suggestOrbitTracks([{ id: 'a1', serverId: 'srv' }, { id: 'a2', serverId: 'srv' }, { id: 'a3', serverId: 'srv' }]);
    // Each read sees the previous append: no two suggestions race on the outbox.
    expect(mocks.log).toEqual(['read:', 'add:a1', 'read:a1', 'add:a2', 'read:a1+a2', 'add:a3']);
    expect(useOrbitStore.getState().pendingSuggestions).toEqual(['a1', 'a2', 'a3']);
    expect(mocks.showToast).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/ctxSuggestedToast|Suggested/), 2200, 'info');
  });

  it('a muted guest gets the muted notice and nothing is written', async () => {
    joinAsGuest(['guest']);
    await suggestOrbitTracks([{ id: 'a1', serverId: 'srv' }, { id: 'a2', serverId: 'srv' }]);
    expect(mocks.log).toEqual([]);
    expect(mocks.showToast).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/suggestBlockedMuted|muted/i), 3500, 'error');
  });
});
