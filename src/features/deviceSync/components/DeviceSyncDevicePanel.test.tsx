import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import i18n from '@/lib/i18n';
import {
  deviceSyncSourceKey,
  type DeviceSyncSource,
} from '@/features/deviceSync/store/deviceSyncStore';
import type { SyncStatus } from '@/features/deviceSync/utils/deviceSyncHelpers';
import DeviceSyncDevicePanel from './DeviceSyncDevicePanel';

const album: DeviceSyncSource = {
  type: 'album', id: 'album-1', name: 'First Album', artist: 'Some Artist', serverIndexKey: 'server.test',
};
const playlist: DeviceSyncSource = {
  type: 'playlist', id: 'playlist-1', name: 'Mix', serverIndexKey: 'server.test',
};

function renderPanel(
  statuses: Record<string, SyncStatus>,
  overrides: Partial<React.ComponentProps<typeof DeviceSyncDevicePanel>> = {},
) {
  const props = {
    sources: [album, playlist],
    sourceStatuses: new Map(Object.entries(statuses)),
    driveDetected: true,
    scanning: false,
    checkedIds: [],
    toggleChecked: vi.fn(),
    allChecked: false,
    toggleAll: vi.fn(),
    isRunning: false,
    handleToggleSource: vi.fn(),
    markForDeletion: vi.fn(),
    unmarkDeletion: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<DeviceSyncDevicePanel {...props} />);
  return props;
}

describe('DeviceSyncDevicePanel', () => {
  const albumKey = deviceSyncSourceKey(album);
  const playlistKey = deviceSyncSourceKey(playlist);

  it('names each status in words, not only with an icon', () => {
    renderPanel({ [albumKey]: 'synced', [playlistKey]: 'pending' });
    expect(screen.getByText(i18n.t('deviceSync.statusSynced'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('deviceSync.statusPending'))).toBeInTheDocument();
  });

  it('shows the artist under an album and the kind under a playlist', () => {
    renderPanel({ [albumKey]: 'synced', [playlistKey]: 'pending' });
    expect(screen.getByText('Some Artist')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('deviceSync.typePlaylist'))).toBeInTheDocument();
  });

  it('wires each row action to the step its status calls for', () => {
    const props = renderPanel({ [albumKey]: 'synced', [playlistKey]: 'pending' });
    fireEvent.click(screen.getByRole('button', {
      name: `${i18n.t('deviceSync.markForDeletion')}: First Album`,
    }));
    expect(props.markForDeletion).toHaveBeenCalledWith([albumKey]);
    fireEvent.click(screen.getByRole('button', {
      name: `${i18n.t('deviceSync.removeSource')}: Mix`,
    }));
    expect(props.handleToggleSource).toHaveBeenCalledWith(playlist);
  });

  it('offers undo for a row marked for deletion', () => {
    const props = renderPanel({ [albumKey]: 'deletion', [playlistKey]: 'pending' });
    fireEvent.click(screen.getByRole('button', {
      name: `${i18n.t('deviceSync.undoDeletion')}: First Album`,
    }));
    expect(props.unmarkDeletion).toHaveBeenCalledWith(albumKey);
  });

  it('says the device is missing instead of listing what it cannot check', () => {
    renderPanel({}, { driveDetected: false });
    expect(screen.getByText(i18n.t('deviceSync.targetMissing'))).toBeInTheDocument();
    expect(screen.queryByText('First Album')).not.toBeInTheDocument();
  });
});
