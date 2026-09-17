import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { _resetShareStoreForTest, useShareStore } from '@/features/share/store/shareStore';
import { useSidebarStore } from '@/features/sidebar/store/sidebarStore';
import MobileMoreOverlay from '@/features/sidebar/components/MobileMoreOverlay';

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
  useSidebarStore.getState().reset();
});

describe('MobileMoreOverlay shared navigation', () => {
  it('uses aggregate shares even when the active server is offline', () => {
    const { rerender } = renderWithProviders(<MobileMoreOverlay onClose={() => {}} />);
    expect(screen.queryByRole('link', { name: 'Shared' })).not.toBeInTheDocument();

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
    rerender(<MobileMoreOverlay onClose={() => {}} />);

    expect(screen.getByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/shared');
  });
});
