import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShareSettingsStore } from '@/features/share/store/shareSettingsStore';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import { IntegrationsTab } from './IntegrationsTab';
import { usePlayQueueSyncSettingsStore } from '@/features/playback/store/playQueueSyncSettingsStore';
import { useThemeStore } from '@/store/themeStore';

vi.mock('./musicNetwork/MusicNetworkSection', () => ({
  MusicNetworkSection: () => null,
}));

describe('IntegrationsTab Navidrome sharing settings', () => {
  beforeEach(resetAllStores);

  it('keeps Navidrome first without absorbing the server Now Playing setting', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<IntegrationsTab />);

    const sharingToggle = screen.getByRole('checkbox', { name: 'Navidrome sharing' });
    const queueSyncToggle = screen.getByRole('checkbox', { name: 'Play queue sync' });
    const nowPlayingToggle = screen.getByRole('checkbox', { name: 'Show in Now Playing' });
    const navidromeSection = screen.getByText('Navidrome').closest('details');

    expect(navidromeSection).not.toBeNull();
    expect(container.querySelector('details')).toBe(navidromeSection);
    expect(within(navidromeSection!).getByRole('checkbox', { name: 'Navidrome sharing' })).toBe(
      sharingToggle,
    );
    expect(within(navidromeSection!).getByRole('checkbox', { name: 'Play queue sync' })).toBe(
      queueSyncToggle,
    );
    expect(within(navidromeSection!).queryByRole('checkbox', { name: 'Allow downloads' })).toBeNull();
    expect(
      within(navidromeSection!).queryByRole('checkbox', { name: 'Show in Now Playing' }),
    ).toBeNull();
    expect(screen.getByText('Show in Now Playing').closest('details')).toContainElement(
      nowPlayingToggle,
    );
    expect(queueSyncToggle).toBeChecked();

    await user.click(queueSyncToggle);
    expect(usePlayQueueSyncSettingsStore.getState().enabled).toBe(false);

    await user.click(sharingToggle);

    const downloadsToggle = within(navidromeSection!).getByRole('checkbox', {
      name: 'Allow downloads',
    });
    expect(downloadsToggle).toBeEnabled();
    expect(downloadsToggle.closest('.settings-norm-block')).not.toBeNull();
    await user.click(downloadsToggle);
    expect(useShareSettingsStore.getState().navidromeSharesDownloadable).toBe(true);
  });
});

describe('IntegrationsTab backgrounds', () => {
  beforeEach(() => {
    resetAllStores();
    useThemeStore.setState(useThemeStore.getInitialState());
  });

  it('offers the backdrop switches with the artwork scraper off, listing only the server image', async () => {
    const user = userEvent.setup();
    useThemeStore.setState({ externalArtworkEnabled: false });
    renderWithProviders(<IntegrationsTab />);

    expect(screen.getByText('Backgrounds')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { name: 'Navidrome image' })).toHaveLength(3);
    expect(screen.queryByRole('checkbox', { name: 'Fanart artist image' })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Fullscreen player' }));
    expect(useThemeStore.getState().backdrops.fullscreenPlayer.enabled).toBe(false);

    const before = useThemeStore.getState().backdrops.mainstageHero.sources;
    await user.click(screen.getAllByRole('checkbox', { name: 'Navidrome image' })[0]);
    const after = useThemeStore.getState().backdrops.mainstageHero.sources;
    expect(after.map(s => s.source)).toEqual(before.map(s => s.source));
    expect(after.find(s => s.source === 'navidrome')?.enabled).toBe(false);
    expect(after.find(s => s.source === 'fanart')?.enabled).toBe(true);
  });

  it('lists every source once the scraper is on', () => {
    useThemeStore.setState({ externalArtworkEnabled: true });
    renderWithProviders(<IntegrationsTab />);
    expect(screen.getAllByRole('checkbox', { name: 'Fanart artist image' })).toHaveLength(3);
  });
});
