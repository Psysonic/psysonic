import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import i18n from '@/lib/i18n';
import type { DeviceSyncPlaylistPathMode } from '@/features/deviceSync/store/deviceSyncStore';
import DeviceSyncHeader from './DeviceSyncHeader';

function renderHeader(playlistPathMode: DeviceSyncPlaylistPathMode) {
  renderWithProviders(
    <DeviceSyncHeader
      targetDir={null}
      setTargetDir={vi.fn()}
      sources={[]}
      drives={[]}
      drivesLoading={false}
      activeDrive={null}
      refreshDrives={vi.fn(async () => {})}
      scanDevice={vi.fn(async () => {})}
      handleChooseFolder={vi.fn(async () => {})}
      startMigrationPreview={vi.fn(async () => {})}
      layoutMode="shared-album-tree"
      playlistPathMode={playlistPathMode}
      setLayoutMode={vi.fn()}
      setPlaylistPathMode={vi.fn()}
      transcode={{ format: 'original', maxBitRateKbps: 320 }}
      setTranscode={vi.fn()}
      targetIsLocal={false}
      isRunning={false}
    />,
  );
}

describe('DeviceSyncHeader absolute path hint', () => {
  const hint = () => i18n.t('deviceSync.playlistPathAbsoluteHint');

  it('explains that absolute paths depend on the mount point', () => {
    renderHeader('absolute');
    expect(screen.getByText(hint())).toBeInTheDocument();
  });

  it('stays hidden for relative path styles', () => {
    renderHeader('playlist-relative');
    expect(screen.queryByText(hint())).not.toBeInTheDocument();
    renderHeader('device-rooted');
    expect(screen.queryByText(hint())).not.toBeInTheDocument();
  });
});
