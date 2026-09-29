import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { _resetShareStoreForTest, useShareStore } from '@/features/share/store/shareStore';
import { useSidebarStore } from '@/features/sidebar/store/sidebarStore';
import MobileMoreOverlay from '@/features/sidebar/components/MobileMoreOverlay';
import { _resetShareSettingsStoreForTest, useShareSettingsStore } from '@/features/share/store/shareSettingsStore';

vi.mock('@/features/sidebar/hooks/useReactiveOfflineBrowseContext', () => ({
  useReactiveOfflineBrowseContext: () => ({
    active: true,
    serverId: null,
    capabilities: {
      localLibrary: false,
      favorites: false,
      playlists: false,
      manualPins: false,
      playerStats: false,
    },
    hasBrowseCapability: false,
    hasBrowsingContent: false,
    connStatus: 'disconnected',
  }),
}));

beforeEach(() => {
  resetAuthStore();
  _resetShareStoreForTest();
  _resetShareSettingsStoreForTest();
  useSidebarStore.getState().reset();
});

describe('MobileMoreOverlay shared navigation', () => {
  it('keeps managed shares available with zero links while the active server is offline', () => {
    useShareSettingsStore.getState().setNavidromeSharingEnabled(true);
    renderWithProviders(<MobileMoreOverlay onClose={() => {}} />);

    expect(screen.getByRole('link', { name: 'ND Shares' })).toHaveAttribute('href', '/shared');
  });

  it('hides managed shares while the integration is disabled', () => {
    useShareStore.setState({
      byServer: {
        'server-a': {
          shares: [{ id: 'share-1', url: 'https://server.test/share/1' }],
          loading: false,
          lastSuccessfulRefresh: 1,
          availability: 'available',
        },
      },
    });

    renderWithProviders(<MobileMoreOverlay onClose={() => {}} />);

    expect(screen.queryByRole('link', { name: 'ND Shares' })).not.toBeInTheDocument();
  });
});
