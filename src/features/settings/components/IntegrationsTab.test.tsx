import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShareSettingsStore } from '@/features/share/store/shareSettingsStore';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import { IntegrationsTab } from './IntegrationsTab';

vi.mock('./musicNetwork/MusicNetworkSection', () => ({
  MusicNetworkSection: () => null,
}));

describe('IntegrationsTab Navidrome sharing settings', () => {
  beforeEach(resetAllStores);

  it('keeps Navidrome first without absorbing the server Now Playing setting', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<IntegrationsTab />);

    const sharingToggle = screen.getByRole('checkbox', { name: 'Navidrome sharing' });
    const downloadsToggle = screen.getByRole('checkbox', { name: 'Allow downloads' });
    const nowPlayingToggle = screen.getByRole('checkbox', { name: 'Show in Now Playing' });
    const navidromeSection = screen.getByText('Navidrome').closest('details');

    expect(navidromeSection).not.toBeNull();
    expect(container.querySelector('details')).toBe(navidromeSection);
    expect(within(navidromeSection!).getByRole('checkbox', { name: 'Navidrome sharing' })).toBe(
      sharingToggle,
    );
    expect(within(navidromeSection!).getByRole('checkbox', { name: 'Allow downloads' })).toBe(
      downloadsToggle,
    );
    expect(
      within(navidromeSection!).queryByRole('checkbox', { name: 'Show in Now Playing' }),
    ).toBeNull();
    expect(screen.getByText('Show in Now Playing').closest('details')).toContainElement(
      nowPlayingToggle,
    );
    expect(downloadsToggle).toBeDisabled();

    await user.click(sharingToggle);

    expect(downloadsToggle).toBeEnabled();
    await user.click(downloadsToggle);
    expect(useShareSettingsStore.getState().navidromeSharesDownloadable).toBe(true);
  });
});
