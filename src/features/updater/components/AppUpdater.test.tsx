import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

const open = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-shell', () => ({ open }));
vi.mock('@/features/updater/hooks/useAppUpdater', () => ({
  useAppUpdater: () => ({
    release: {
      version: '1.54.0-rc.2',
      tag: 'app-v1.54.0-rc.2',
      body: 'Release notes',
      assets: [],
    },
    dismissed: false,
    setDismissed: vi.fn(),
    changelogOpen: false,
    setChangelogOpen: vi.fn(),
    dlState: 'idle',
    dlProgress: { bytes: 0, total: 0 },
    dlError: '',
    countdown: null,
    asset: undefined,
    isFlatpakBuild: true,
    flatpakUpdateCommand: 'flatpak update --user io.github.psysonic.psysonic//rc',
    showAurHint: false,
    showWingetHint: false,
    updaterPlatform: null,
    useTauriUpdater: false,
    showInstallBtn: false,
    pct: 0,
    handleSkip: vi.fn(),
    handleRestartNow: vi.fn(),
    handleDownload: vi.fn(),
    handleShowFolder: vi.fn(),
  }),
}));

import AppUpdater from '@/features/updater/components/AppUpdater';

describe('AppUpdater Flatpak instructions', () => {
  it('shows the branch-specific update command and release link', () => {
    renderWithProviders(<AppUpdater />);

    expect(screen.getByText('Run this command, then restart Psysonic:')).toBeInTheDocument();
    expect(screen.getByText('flatpak update --user io.github.psysonic.psysonic//rc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open on GitHub' })).toBeInTheDocument();
  });
});
