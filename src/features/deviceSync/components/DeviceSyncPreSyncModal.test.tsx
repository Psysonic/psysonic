import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import i18n from '@/lib/i18n';
import type { SyncDelta } from '@/features/deviceSync/utils/runDeviceSyncExecution';
import DeviceSyncPreSyncModal from './DeviceSyncPreSyncModal';

function delta(overrides: Partial<SyncDelta> = {}): SyncDelta {
  return {
    planId: 'plan',
    deviceId: 'device',
    addBytes: 0,
    addCount: 0,
    delBytes: 0,
    delCount: 0,
    reclaimableBytes: 0,
    availableBytes: 1,
    tracks: [],
    deletePaths: [],
    deferredDeletePaths: [],
    moveCount: 0,
    skippedCount: 0,
    skippedTracks: [],
    playlists: [],
    manifestFiles: [],
    manifestPlaylists: [],
    context: null,
    ...overrides,
  };
}

function renderModal(syncDelta: SyncDelta) {
  renderWithProviders(
    <DeviceSyncPreSyncModal
      preSyncOpen
      preSyncLoading={false}
      syncDelta={syncDelta}
      onCancel={vi.fn()}
      onProceed={vi.fn()}
    />,
  );
}

describe('DeviceSyncPreSyncModal skipped duplicates', () => {
  const label = () => i18n.t('deviceSync.filesSkippedDuplicate');

  it('reports tracks left off because another track takes their file name', () => {
    renderModal(delta({ skippedCount: 3 }));
    const row = screen.getByText(label()).parentElement;
    expect(row).toHaveTextContent('3');
  });

  it('lists both tracks and the file once the row is opened', () => {
    renderModal(delta({
      skippedCount: 1,
      skippedTracks: [{
        track: { title: 'Song (Live)', artist: 'Guest', album: 'Album' },
        keptTrack: { title: 'Song', artist: 'Headliner', album: 'Album' },
        relativePath: 'Headliner/Album/01 - Song.flac',
      }],
    }));
    const row = screen.getByRole('button', { name: new RegExp(label().replace(/[()]/g, '\\$&')) });

    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Headliner/Album/01 - Song.flac')).not.toBeInTheDocument();

    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Song (Live) · Guest · Album')).toBeInTheDocument();
    expect(screen.getByText(/Song · Headliner · Album/)).toBeInTheDocument();
    expect(screen.getByText('Headliner/Album/01 - Song.flac')).toBeInTheDocument();
  });

  it('shows no row when nothing was skipped', () => {
    renderModal(delta());
    expect(screen.queryByText(label())).not.toBeInTheDocument();
  });
});
