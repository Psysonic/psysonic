import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeServer } from '@/test/helpers/factories';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { _resetShareSettingsStoreForTest, useShareSettingsStore } from '@/features/share/store/shareSettingsStore';

const shareActions = vi.hoisted(() => ({
  reconcileProfiles: vi.fn(),
  refreshAll: vi.fn(async () => {}),
}));

vi.mock('@/features/share/store/shareStore', () => ({
  useShareStore: { getState: () => shareActions },
}));

import { useAuthStore } from '@/store/authStore';
import { useShareBootstrap } from '@/features/share/hooks/useShareBootstrap';

beforeEach(() => {
  resetAuthStore();
  _resetShareSettingsStoreForTest();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', undefined);
});

describe('useShareBootstrap', () => {
  it('reconciles profiles but waits for authentication before refreshing', async () => {
    useShareSettingsStore.getState().setNavidromeSharingEnabled(true);
    const server = makeServer({ id: 'srv-a' });
    useAuthStore.setState({ servers: [server], isLoggedIn: false });
    renderHook(() => useShareBootstrap());

    expect(shareActions.reconcileProfiles).toHaveBeenCalledWith([server]);
    await act(async () => vi.runAllTimersAsync());
    expect(shareActions.refreshAll).not.toHaveBeenCalled();
  });

  it('defers refresh until after the authenticated mount effect', async () => {
    useShareSettingsStore.getState().setNavidromeSharingEnabled(true);
    const server = makeServer({ id: 'srv-a' });
    useAuthStore.setState({ servers: [server], isLoggedIn: true });
    renderHook(() => useShareBootstrap());

    expect(shareActions.refreshAll).not.toHaveBeenCalled();
    await act(async () => vi.runAllTimersAsync());
    expect(shareActions.refreshAll).toHaveBeenCalledTimes(1);
  });

  it('refreshes again when the selected server cluster changes', async () => {
    useShareSettingsStore.getState().setNavidromeSharingEnabled(true);
    const first = makeServer({ id: 'srv-a' });
    const second = makeServer({ id: 'srv-b' });
    useAuthStore.setState({
      servers: [first, second],
      activeServerId: 'srv-a',
      libraryBrowseServerIds: ['srv-a'],
      isLoggedIn: true,
    });
    renderHook(() => useShareBootstrap());
    await act(async () => vi.runAllTimersAsync());

    act(() => useAuthStore.setState({ libraryBrowseServerIds: ['srv-b'] }));
    await act(async () => vi.runAllTimersAsync());

    expect(shareActions.refreshAll).toHaveBeenCalledTimes(2);
  });

  it('clears managed-share state without refreshing while the integration is disabled', async () => {
    const server = makeServer({ id: 'srv-a' });
    useAuthStore.setState({ servers: [server], isLoggedIn: true });
    renderHook(() => useShareBootstrap());

    expect(shareActions.reconcileProfiles).toHaveBeenCalledWith([]);
    await act(async () => vi.runAllTimersAsync());
    expect(shareActions.refreshAll).not.toHaveBeenCalled();
  });
});
