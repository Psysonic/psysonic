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

  it('keeps download permission under Navidrome sharing and disabled until sharing is enabled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IntegrationsTab />);

    const sharingToggle = screen.getByRole('checkbox', { name: 'Navidrome sharing' });
    const downloadsToggle = screen.getByRole('checkbox', { name: 'Allow downloads' });
    const navidromeSection = screen.getByText('Navidrome sharing').closest('details');

    expect(navidromeSection).not.toBeNull();
    expect(within(navidromeSection!).getByRole('checkbox', { name: 'Allow downloads' })).toBe(
      downloadsToggle,
    );
    expect(downloadsToggle).toBeDisabled();

    await user.click(sharingToggle);

    expect(downloadsToggle).toBeEnabled();
    await user.click(downloadsToggle);
    expect(useShareSettingsStore.getState().navidromeSharesDownloadable).toBe(true);
  });
});
