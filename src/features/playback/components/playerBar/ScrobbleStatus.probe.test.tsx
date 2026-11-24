import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useOfflineBrowseActive } from '@/features/offline';
import i18n from '@/lib/i18n';
import { ScrobbleActionButton } from './ScrobbleStatus';

// The probing hook: every component that calls it probes the server on mount and every 120 s.
const useConnectionStatus = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('@/lib/hooks/useConnectionStatus', () => ({ useConnectionStatus }));

describe('ScrobbleActionButton server probing', () => {
  beforeEach(() => {
    resetAllStores();
    useConnectionStatus.mockClear();
  });

  it('does not start a server probe of its own (the app shell does that)', () => {
    renderWithProviders(<ScrobbleActionButton t={i18n.t} className="player-btn" />);
    expect(useConnectionStatus).not.toHaveBeenCalled();
  });

  it('positive control: the probing offline hook does call it', () => {
    renderHook(() => useOfflineBrowseActive());
    expect(useConnectionStatus).toHaveBeenCalled();
  });
});
