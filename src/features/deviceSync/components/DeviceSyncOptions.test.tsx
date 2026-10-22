import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import i18n from '@/lib/i18n';
import {
  useDeviceSyncStore,
  type DeviceSyncLayoutMode,
  type DeviceSyncPlaylistPathMode,
  type DeviceSyncTranscode,
} from '@/features/deviceSync/store/deviceSyncStore';
import DeviceSyncOptions from './DeviceSyncOptions';

const ORIGINAL: DeviceSyncTranscode = { format: 'original', maxBitRateKbps: 320 };

function renderOptions({
  layoutMode = 'self-contained',
  playlistPathMode = 'playlist-relative',
  showMigrate = false,
}: {
  layoutMode?: DeviceSyncLayoutMode;
  playlistPathMode?: DeviceSyncPlaylistPathMode;
  showMigrate?: boolean;
} = {}) {
  return renderWithProviders(
    <DeviceSyncOptions
      layoutMode={layoutMode}
      playlistPathMode={playlistPathMode}
      setLayoutMode={vi.fn()}
      setPlaylistPathMode={vi.fn()}
      transcode={ORIGINAL}
      setTranscode={vi.fn()}
      targetIsLocal={false}
      isRunning={false}
      showMigrate={showMigrate}
      startMigrationPreview={vi.fn(async () => {})}
    />,
  );
}

const toggle = () => screen.getByRole('button', { name: new RegExp(i18n.t('deviceSync.optionsTitle')) });

describe('DeviceSyncOptions', () => {
  beforeEach(() => {
    useDeviceSyncStore.setState({ optionsExpanded: false });
  });

  it('starts closed and sums up the current choices', () => {
    renderOptions({ layoutMode: 'shared-album-tree' });
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveTextContent(i18n.t('deviceSync.playlistStorageShared'));
    expect(toggle()).toHaveTextContent(i18n.t('deviceSync.transcodeOriginal'));
    expect(screen.queryByText(i18n.t('deviceSync.layout'))).not.toBeInTheDocument();
  });

  it('opens on click and remembers it in the store', () => {
    renderOptions();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(useDeviceSyncStore.getState().optionsExpanded).toBe(true);
    expect(screen.getByText(i18n.t('deviceSync.layout'))).toBeInTheDocument();
  });

  it('shows where a track lands for the chosen layout', () => {
    useDeviceSyncStore.setState({ optionsExpanded: true });
    const artist = i18n.t('deviceSync.exampleArtist');
    const album = i18n.t('deviceSync.exampleAlbum');
    const title = i18n.t('deviceSync.exampleTitle');
    const { unmount } = renderOptions({ layoutMode: 'flat' });
    expect(screen.getByText(`${artist} - ${album} - 01 - ${title}.flac`)).toBeInTheDocument();
    unmount();
    renderOptions({ layoutMode: 'self-contained' });
    expect(screen.getByText(`${artist}/${album}/01 - ${title}.flac`)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^Playlists/`))).toBeInTheDocument();
  });

  it('explains that absolute paths depend on the mount point, and only then', () => {
    useDeviceSyncStore.setState({ optionsExpanded: true });
    const hint = i18n.t('deviceSync.playlistPathAbsoluteHint');
    const { unmount } = renderOptions({ playlistPathMode: 'absolute' });
    expect(screen.getByText(hint)).toBeInTheDocument();
    unmount();
    renderOptions({ playlistPathMode: 'playlist-relative' });
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });

  it('offers to reorganize old files only when the device needs it', () => {
    useDeviceSyncStore.setState({ optionsExpanded: true });
    const label = i18n.t('deviceSync.migrateButton');
    const { unmount } = renderOptions({ showMigrate: false });
    expect(screen.queryByText(label)).not.toBeInTheDocument();
    unmount();
    renderOptions({ showMigrate: true });
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
