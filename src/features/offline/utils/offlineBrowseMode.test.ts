import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useDevOfflineBrowseStore } from '@/store/devOfflineBrowseStore';
import { useAuthStore } from '@/store/authStore';
import {
  resetActiveServerConnectionSnapshot,
  setActiveServerReachable,
  setConnectionStatus,
} from '@/lib/network/activeServerReachability';
import { onInvoke } from '@/test/mocks/tauri';
import {
  useOfflineBrowseActive,
  useOfflineBrowseStatus,
} from '@/features/offline/utils/offlineBrowseMode';

describe('useOfflineBrowseActive', () => {
  beforeEach(() => {
    useDevOfflineBrowseStore.setState({ forceOffline: false });
    resetActiveServerConnectionSnapshot();
  });

  it('enables offline browse when DEV force-offline is set', () => {
    if (!import.meta.env.DEV) return;

    act(() => {
      useDevOfflineBrowseStore.getState().setForceOffline(true);
    });

    const { result } = renderHook(() => useOfflineBrowseActive());
    expect(result.current).toBe(true);
  });
});

describe('useOfflineBrowseStatus', () => {
  beforeEach(() => {
    useDevOfflineBrowseStore.setState({ forceOffline: false });
    resetActiveServerConnectionSnapshot();
  });

  it('follows the shared connection status as it changes', () => {
    act(() => {
      setActiveServerReachable(true);
      setConnectionStatus('connected');
    });
    const { result } = renderHook(() => useOfflineBrowseStatus());
    expect(result.current).toBe(false);

    act(() => {
      setActiveServerReachable(false);
      setConnectionStatus('disconnected');
    });
    expect(result.current).toBe(true);
  });

  it('does not probe the server itself', () => {
    const id = useAuthStore.getState().addServer({
      name: 'T', url: 'https://x.test', username: 'u', password: 'p',
    });
    useAuthStore.getState().setActiveServer(id);
    let probes = 0;
    onInvoke('probe_server_connection', () => {
      probes += 1;
      return { ok: false };
    });

    renderHook(() => useOfflineBrowseStatus());
    expect(probes).toBe(0);

    // Positive control: the probing hook does reach the server in the same setup.
    renderHook(() => useOfflineBrowseActive());
    return new Promise<void>(resolve => setTimeout(() => {
      expect(probes).toBeGreaterThan(0);
      resolve();
    }, 50));
  });
});
