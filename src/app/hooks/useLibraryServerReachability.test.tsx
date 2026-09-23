import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { setServerReachability } from '@/lib/network/serverReachability';
import { useLibraryServerReachability } from './useLibraryServerReachability';

const switchActiveServerMock = vi.hoisted(() => vi.fn());
const bootstrapIndexedServerMock = vi.hoisted(() => vi.fn());
const ensureConnectUrlResolvedMock = vi.hoisted(() => vi.fn());
const scheduleInstantMixProbeForServerMock = vi.hoisted(() => vi.fn());
const perfFlags = vi.hoisted(() => ({ disableBackgroundPolling: true }));

vi.mock('@/utils/server/switchActiveServer', () => ({
  switchActiveServer: switchActiveServerMock,
}));

vi.mock('@/lib/perf/perfFlags', () => ({
  usePerfProbeFlags: () => perfFlags,
}));

vi.mock('@/lib/server/serverEndpoint', () => ({
  ensureConnectUrlResolved: ensureConnectUrlResolvedMock,
  invalidateReachableEndpointCache: vi.fn(),
}));

vi.mock('@/lib/api/subsonic', () => ({
  scheduleInstantMixProbeForServer: scheduleInstantMixProbeForServerMock,
}));

vi.mock('@/lib/library/librarySession', () => ({
  bootstrapIndexedServer: bootstrapIndexedServerMock,
}));

beforeEach(() => {
  resetAuthStore();
  switchActiveServerMock.mockReset();
  bootstrapIndexedServerMock.mockReset().mockResolvedValue('bound');
  ensureConnectUrlResolvedMock.mockReset();
  scheduleInstantMixProbeForServerMock.mockReset();
  perfFlags.disableBackgroundPolling = true;
  switchActiveServerMock.mockImplementation(async (server: { id: string }) => {
    useAuthStore.getState().setActiveServer(server.id);
    return true;
  });
  useAuthStore.setState({
    servers: [
      { id: 'a', name: 'A', url: 'https://a.test', username: 'u', password: 'p' },
      { id: 'b', name: 'B', url: 'https://b.test', username: 'u', password: 'p' },
      { id: 'c', name: 'C', url: 'https://c.test', username: 'u', password: 'p' },
    ],
    activeServerId: 'a',
    libraryBrowseServerIds: ['a', 'b'],
    libraryBrowseScopeVersion: 0,
    isLoggedIn: true,
  });
});

describe('useLibraryServerReachability', () => {
  it('switches active server when checkbox membership changes the priority head', async () => {
    renderHook(() => useLibraryServerReachability());

    act(() => useAuthStore.getState().setLibraryBrowseServerSelected('a', false));

    await waitFor(() => expect(switchActiveServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
    ));
    expect(useAuthStore.getState().activeServerId).toBe('b');
  });

  it('realigns an independently switched active server on the next checkbox change', async () => {
    renderHook(() => useLibraryServerReachability());
    act(() => useAuthStore.getState().setActiveServer('b'));
    expect(switchActiveServerMock).not.toHaveBeenCalled();

    act(() => useAuthStore.getState().setLibraryBrowseServerSelected('c', true));

    await waitFor(() => expect(switchActiveServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
    ));
    expect(useAuthStore.getState().activeServerId).toBe('a');
  });

  it('switches active server when reordering changes the priority head', async () => {
    renderHook(() => useLibraryServerReachability());
    const { servers } = useAuthStore.getState();

    act(() => useAuthStore.getState().setServers([servers[1], servers[0], servers[2]]));

    await waitFor(() => expect(switchActiveServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
    ));
    expect(useAuthStore.getState().libraryBrowseServerIds).toEqual(['b', 'a']);
    expect(useAuthStore.getState().activeServerId).toBe('b');
  });

  it('switches to the first selected server that is not confirmed unavailable', async () => {
    renderHook(() => useLibraryServerReachability());

    act(() => setServerReachability('a', 'unavailable'));

    await waitFor(() => expect(switchActiveServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
    ));
    expect(useAuthStore.getState().activeServerId).toBe('b');
    expect(useAuthStore.getState().libraryBrowseServerIds).toEqual(['a', 'b']);
  });

  it('invalidates Library reads only when availability changes the effective scope', async () => {
    renderHook(() => useLibraryServerReachability());

    act(() => setServerReachability('c', 'unavailable'));
    expect(useAuthStore.getState().libraryBrowseScopeVersion).toBe(0);

    act(() => setServerReachability('b', 'unavailable'));
    await waitFor(() => expect(useAuthStore.getState().libraryBrowseScopeVersion).toBe(1));

    act(() => setServerReachability('b', 'available'));
    await waitFor(() => expect(useAuthStore.getState().libraryBrowseScopeVersion).toBe(2));
    expect(useAuthStore.getState().libraryBrowseServerIds).toEqual(['a', 'b']);
  });

  it('rebinds a recovered indexed server without requiring an active-server or list change', async () => {
    act(() => setServerReachability('b', 'unavailable'));
    renderHook(() => useLibraryServerReachability());

    act(() => setServerReachability('b', 'available'));

    await waitFor(() => expect(bootstrapIndexedServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
    ));
    expect(useAuthStore.getState().activeServerId).toBe('a');
    expect(switchActiveServerMock).not.toHaveBeenCalled();
  });

  it('refreshes identities for every selected server from the reachability probes', async () => {
    perfFlags.disableBackgroundPolling = false;
    useAuthStore.setState({
      subsonicServerIdentityByServer: {
        a: { type: 'navidrome', serverVersion: '0.63.2', openSubsonic: true },
        b: { type: 'navidrome', serverVersion: '0.63.2', openSubsonic: true },
      },
    });
    ensureConnectUrlResolvedMock.mockImplementation(async (server: { url: string }) => ({
      ok: true,
      baseUrl: server.url,
      endpoint: { kind: 'public', url: server.url },
      ping: { ok: true, type: 'navidrome', serverVersion: '0.64.0', openSubsonic: true },
    }));

    renderHook(() => useLibraryServerReachability());

    await waitFor(() => expect(ensureConnectUrlResolvedMock).toHaveBeenCalledTimes(2));
    expect(useAuthStore.getState().subsonicServerIdentityByServer).toMatchObject({
      a: { serverVersion: '0.64.0' },
      b: { serverVersion: '0.64.0' },
    });
    expect(scheduleInstantMixProbeForServerMock).toHaveBeenCalledTimes(2);
    expect(scheduleInstantMixProbeForServerMock).toHaveBeenCalledWith(
      'b',
      'https://b.test',
      'u',
      'p',
      { type: 'navidrome', serverVersion: '0.64.0', openSubsonic: true },
    );
  });
});
