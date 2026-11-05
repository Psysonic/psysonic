import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrbitState } from '@/features/orbit/api/orbit';

const mocks = vi.hoisted(() => ({
  writeOrbitState: vi.fn((..._args: unknown[]) => Promise.resolve()),
  createPlaylist: vi.fn((name: string) => Promise.resolve({ id: `pl-${name}` })),
  orbitSetState: vi.fn(),
  setPhase: vi.fn(),
}));

vi.mock('@/features/orbit/utils/remote', () => ({
  writeOrbitState: mocks.writeOrbitState,
  writeOrbitHeartbeat: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/features/orbit/store/orbitStore', () => ({
  useOrbitStore: {
    getState: () => ({ phase: 'idle', bindingRevision: 1, setPhase: mocks.setPhase }),
    setState: mocks.orbitSetState,
  },
  orbitBindingIsCurrent: () => true,
  orbitBindingRevisionIsCurrent: () => true,
}));
vi.mock('@/store/authStore', () => {
  const server = { id: 'srv-a', username: 'host', url: 'https://a.example' };
  return {
    useAuthStore: {
      getState: () => ({
        servers: [server],
        activeServerId: 'srv-a',
        libraryBrowseServerIds: ['srv-a'],
        getActiveServer: () => server,
        setLibraryBrowseServerExclusive: vi.fn(),
      }),
      setState: vi.fn(),
    },
  };
});
vi.mock('@/features/playback/store/playerStore', () => ({
  usePlayerStore: { getState: () => ({ clearQueue: vi.fn(), retainQueueForServer: vi.fn() }) },
}));
vi.mock('@/lib/api/subsonicPlaylists', () => ({
  createPlaylist: mocks.createPlaylist,
  deletePlaylist: vi.fn(),
}));
vi.mock('@/lib/api/subsonicLibrary', () => ({ getSongForServer: vi.fn() }));
vi.mock('@/lib/media/songToTrack', () => ({ songToTrack: vi.fn() }));
vi.mock('@/utils/server/switchActiveServer', () => ({ switchActiveServer: vi.fn(() => Promise.resolve(true)) }));
vi.mock('@/features/orbit/utils/transitions', () => ({ readOrbitTransitionSettings: () => undefined }));

import { startOrbitSession } from '@/features/orbit/utils/host';

/** The state blob the session was seeded with. */
function seededState(): OrbitState {
  const calls = mocks.writeOrbitState.mock.calls as unknown as Array<[string, OrbitState]>;
  return calls[calls.length - 1][1];
}

beforeEach(() => {
  mocks.writeOrbitState.mockClear();
  mocks.orbitSetState.mockClear();
});

describe('startOrbitSession — automatic reshuffle', () => {
  it('seeds the session with the reshuffle off when the host chose off', async () => {
    await startOrbitSession({ name: 'sesh', sid: 'aaaa1111', serverId: 'srv-a', autoShuffle: false });
    expect(seededState().settings?.autoShuffle).toBe(false);
  });

  it('seeds the session with the reshuffle on when the host chose on', async () => {
    await startOrbitSession({ name: 'sesh', sid: 'aaaa1111', serverId: 'srv-a', autoShuffle: true });
    expect(seededState().settings?.autoShuffle).toBe(true);
  });

  it('keeps the protocol default when the caller does not choose', async () => {
    await startOrbitSession({ name: 'sesh', sid: 'aaaa1111', serverId: 'srv-a' });
    expect(seededState().settings?.autoShuffle).toBe(true);
  });
});
