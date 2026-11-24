import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useDevOfflineBrowseStore } from '@/store/devOfflineBrowseStore';
import {
  resetActiveServerConnectionSnapshot,
  setActiveServerReachable,
  setConnectionStatus,
} from '@/lib/network/activeServerReachability';
import {
  useOfflineBrowseActive,
  useOfflineBrowseStatus,
} from '@/features/offline/utils/offlineBrowseMode';

// The probing hook: every caller probes the server on mount and every 120 s.
const useConnectionStatus = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('@/lib/hooks/useConnectionStatus', () => ({ useConnectionStatus }));

describe('useOfflineBrowseActive', () => {
  beforeEach(() => {
    useDevOfflineBrowseStore.setState({ forceOffline: false });
    resetActiveServerConnectionSnapshot();
    useConnectionStatus.mockClear();
  });

  it('enables offline browse when DEV force-offline is set', () => {
    if (!import.meta.env.DEV) return;

    act(() => {
      useDevOfflineBrowseStore.getState().setForceOffline(true);
    });

    const { result } = renderHook(() => useOfflineBrowseActive());
    expect(result.current).toBe(true);
  });

  it('starts the server probe', () => {
    renderHook(() => useOfflineBrowseActive());
    expect(useConnectionStatus).toHaveBeenCalled();
  });
});

describe('useOfflineBrowseStatus', () => {
  beforeEach(() => {
    useDevOfflineBrowseStore.setState({ forceOffline: false });
    resetActiveServerConnectionSnapshot();
    useConnectionStatus.mockClear();
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

  it('does not start a server probe of its own', () => {
    renderHook(() => useOfflineBrowseStatus());
    expect(useConnectionStatus).not.toHaveBeenCalled();
  });
});
