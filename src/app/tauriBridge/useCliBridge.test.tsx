import { StrictMode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import type { NavigateFunction } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { tauriMockListenerCount } from '@/test/mocks/tauri';
import { useCliBridge } from './useCliBridge';

const CLI_EVENTS = [
  'cli:audio-device-set',
  'cli:instant-mix',
  'cli:library-list',
  'cli:library-set',
  'cli:server-list',
  'cli:server-set',
  'cli:search',
  'cli:player-command',
];

describe('useCliBridge', () => {
  it('does not retain duplicate CLI listeners after StrictMode remounts', async () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    const { unmount } = renderHook(() => useCliBridge(navigate), { wrapper: StrictMode });

    await waitFor(() => {
      for (const event of CLI_EVENTS) {
        expect(tauriMockListenerCount(event), event).toBe(1);
      }
    });

    unmount();
    for (const event of CLI_EVENTS) {
      expect(tauriMockListenerCount(event), event).toBe(0);
    }
  });
});
