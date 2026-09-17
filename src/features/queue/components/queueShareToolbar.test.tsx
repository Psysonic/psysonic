import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueuePanel from '@/features/queue/components/QueuePanel';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { resetAllStores } from '@/test/helpers/storeReset';
import { makeTrack, seedQueue } from '@/test/helpers/factories';
import { onInvoke, registerDefaultCoverInvokeHandlers } from '@/test/mocks/tauri';
import { decodeSharePayloadFromText } from '@/lib/share/shareLink';
import { _resetShareStoreForTest, useShareStore } from '@/features/share/store/shareStore';
import { useShareSettingsStore } from '@/features/share/store/shareSettingsStore';

const copyTextToClipboardMock = vi.fn(async (_text: string) => true);
const createShareMock = vi.fn(async (_serverId: string, _ids: readonly string[]) => ({
  id: 'native-share',
  url: 'https://x.test/share/native-share',
}));

vi.mock('@/lib/server/serverMagicString', () => ({
  copyTextToClipboard: (text: string) => copyTextToClipboardMock(text),
}));

vi.mock('@/features/orbit/utils/orbitBulkGuard', () => ({
  orbitBulkGuard: vi.fn(async () => true),
}));

vi.mock('@/lib/api/subsonic', () => ({
  savePlayQueue: vi.fn(async () => undefined),
  getPlayQueue: vi.fn(async () => ({ songs: [], current: undefined, position: 0 })),
  buildStreamUrl: vi.fn((id: string) => `https://mock/stream/${id}`),
  buildCoverArtUrl: vi.fn((id: string) => `https://mock/cover/${id}`),
  getSong: vi.fn(async () => null),
}));

function enableNavidromeSharing(serverId: string) {
  useAuthStore.getState().setSubsonicServerIdentity(serverId, {
    type: 'navidrome',
    serverVersion: '0.64.0',
  });
  useShareStore.setState(state => ({
    byServer: {
      ...state.byServer,
      [serverId]: {
        shares: [],
        loading: false,
        lastSuccessfulRefresh: Date.now(),
        availability: 'available',
      },
    },
  }));
}

function seedPublicShareQueue(pageUrl: string) {
  const track = {
    ...makeTrack({ id: 'ndshare:AbCdEfGhIj:0', serverId: 'navidrome-public-share' }),
    directStreamUrl: 'https://music.test/share/s/jwt-token',
  };
  usePlayerStore.setState({
    queueServerId: 'navidrome-public-share',
    navidromePublicSharePageUrl: pageUrl,
    queueItems: [{
      serverId: 'navidrome-public-share',
      trackId: 'ndshare:AbCdEfGhIj:0',
      directStreamUrl: track.directStreamUrl,
    }],
    queueIndex: 0,
    currentTrack: track,
  });
}

describe('QueuePanel share toolbar', () => {
  beforeEach(() => {
    resetAllStores();
    _resetShareStoreForTest();
    useShareSettingsStore.getState().setNavidromeSharingEnabled(true);
    copyTextToClipboardMock.mockClear();
    createShareMock.mockClear();
    useShareStore.setState({ createShare: createShareMock });
    const id = useAuthStore.getState().addServer({
      name: 'T', url: 'https://x.test', username: 'u', password: 'p',
    });
    useAuthStore.getState().setActiveServer(id);
    enableNavidromeSharing(id);
    registerDefaultCoverInvokeHandlers();
    onInvoke('audio_play', () => undefined);
    onInvoke('audio_pause', () => undefined);
    onInvoke('audio_stop', () => undefined);
    onInvoke('audio_seek', () => undefined);
    onInvoke('audio_get_state', () => ({ playing: false }));
    onInvoke('audio_update_replay_gain', () => undefined);
    onInvoke('discord_update_presence', () => undefined);
    onInvoke('library_get_recent_play_sessions', () => []);
  });

  it('hides Save Playlist in the playlist menu for a Navidrome public share queue', () => {
    seedPublicShareQueue('https://music.test/share/AbCdEfGhIj');
    const { getByLabelText, container } = renderWithProviders(<QueuePanel />);
    fireEvent.click(getByLabelText('Playlist'));
    const menu = container.querySelector('.queue-menu');
    expect(menu?.textContent).not.toContain('Save Playlist');
    expect(menu?.textContent).toContain('Load Playlist');
  });

  it('copies the original URL for an imported public share', async () => {
    const pageUrl = 'https://music.test/share/AbCdEfGhIj';
    seedPublicShareQueue(pageUrl);
    const { getByLabelText, getByRole } = renderWithProviders(<QueuePanel />);
    fireEvent.click(getByLabelText('Copy Navidrome share link'));
    fireEvent.click(within(getByRole('menu')).getByRole('menuitem', { name: 'Navidrome' }));
    await waitFor(() => expect(copyTextToClipboardMock).toHaveBeenCalledWith(pageUrl));
  });

  it('offers both methods for a single-server queue and preserves queue order', async () => {
    const serverId = useAuthStore.getState().activeServerId!;
    const first = makeTrack({ id: 'track-b', serverId });
    const second = makeTrack({ id: 'track-a', serverId });
    seedQueue([first, second], { currentTrack: first, serverId });

    const { getByLabelText, getByRole } = renderWithProviders(<QueuePanel />);
    fireEvent.click(getByLabelText('Copy queue share link'));
    let menu = getByRole('menu', { name: 'Copy queue share link' });
    expect(within(menu).getByRole('menuitem', { name: 'Psysonic' })).not.toHaveAttribute('aria-disabled');
    expect(within(menu).getByRole('menuitem', { name: 'Navidrome' })).not.toHaveAttribute('aria-disabled');

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Psysonic' }));
    await waitFor(() => expect(copyTextToClipboardMock).toHaveBeenCalledOnce());
    expect(decodeSharePayloadFromText(copyTextToClipboardMock.mock.calls[0]![0])).toEqual({
      srv: 'https://x.test',
      k: 'queue',
      ids: ['track-b', 'track-a'],
    });

    fireEvent.click(getByLabelText('Copy queue share link'));
    menu = getByRole('menu', { name: 'Copy queue share link' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Navidrome' }));
    await waitFor(() => expect(createShareMock).toHaveBeenCalledWith(serverId, ['track-b', 'track-a'], 'queue'));
    expect(copyTextToClipboardMock).toHaveBeenLastCalledWith('https://x.test/share/native-share');
  });

  it('offers both share methods for each server in a mixed-server queue', async () => {
    const firstServerId = useAuthStore.getState().activeServerId!;
    const secondServerId = useAuthStore.getState().addServer({
      name: 'Second', url: 'https://second.test', username: 'u2', password: 'p2',
    });
    enableNavidromeSharing(secondServerId);
    const first = makeTrack({ id: 'first', serverId: firstServerId });
    const second = makeTrack({ id: 'second', serverId: secondServerId });
    seedQueue([first, second], { currentTrack: first, serverId: firstServerId });

    const { getByLabelText, getByRole } = renderWithProviders(<QueuePanel />);
    fireEvent.click(getByLabelText('Copy queue share link'));
    const menu = getByRole('menu', { name: 'Copy queue share link' });
    expect(within(menu).getByRole('note')).toHaveTextContent(
      'Multi-server queueChoose a server to share its tracks.',
    );
    const secondServer = within(menu).getByRole('menuitem', { name: 'Second' });
    expect(secondServer).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(secondServer);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Psysonic' }));

    await waitFor(() => expect(copyTextToClipboardMock).toHaveBeenCalledOnce());
    expect(decodeSharePayloadFromText(copyTextToClipboardMock.mock.calls[0]![0])).toEqual({
      srv: 'https://second.test',
      k: 'queue',
      ids: ['second'],
    });

    fireEvent.click(getByLabelText('Copy queue share link'));
    const reopenedMenu = getByRole('menu', { name: 'Copy queue share link' });
    fireEvent.click(within(reopenedMenu).getByRole('menuitem', { name: 'Second' }));
    fireEvent.click(within(reopenedMenu).getByRole('menuitem', { name: 'Navidrome' }));

    await waitFor(() => expect(createShareMock).toHaveBeenCalledWith(
      secondServerId,
      ['second'],
      'queue',
    ));
    expect(copyTextToClipboardMock).toHaveBeenLastCalledWith('https://x.test/share/native-share');
  });

  it('opens and closes a server method submenu with arrow keys', async () => {
    const user = userEvent.setup();
    const firstServerId = useAuthStore.getState().activeServerId!;
    const secondServerId = useAuthStore.getState().addServer({
      name: 'Second', url: 'https://second.test', username: 'u2', password: 'p2',
    });
    enableNavidromeSharing(secondServerId);
    const first = makeTrack({ id: 'first', serverId: firstServerId });
    seedQueue([
      first,
      makeTrack({ id: 'second', serverId: secondServerId }),
    ], { currentTrack: first, serverId: firstServerId });

    const { getByLabelText, getByRole } = renderWithProviders(<QueuePanel />);
    await user.click(getByLabelText('Copy queue share link'));
    const menu = getByRole('menu', { name: 'Copy queue share link' });
    const secondServer = within(menu).getByRole('menuitem', { name: 'Second' });
    secondServer.focus();

    await user.keyboard('{ArrowRight}');
    const psysonicMethod = within(menu).getByRole('menuitem', { name: 'Psysonic' });
    await waitFor(() => expect(psysonicMethod).toHaveFocus());

    await user.keyboard('{ArrowLeft}');
    expect(secondServer).toHaveFocus();
    expect(within(menu).queryByRole('menuitem', { name: 'Psysonic' })).not.toBeInTheDocument();
  });

  it('copies a single-server Psysonic queue directly when the integration is disabled', async () => {
    useShareSettingsStore.getState().setNavidromeSharingEnabled(false);
    const serverId = useAuthStore.getState().activeServerId!;
    seedQueue([makeTrack({ id: 'track-1', serverId })], { serverId });

    const { getByLabelText, queryByRole } = renderWithProviders(<QueuePanel />);
    fireEvent.click(getByLabelText('Copy queue share link'));

    await waitFor(() => expect(copyTextToClipboardMock).toHaveBeenCalledOnce());
    expect(queryByRole('menu', { name: 'Copy queue share link' })).not.toBeInTheDocument();
  });

  it('restores the server picker for a mixed-server Psysonic queue when disabled', async () => {
    useShareSettingsStore.getState().setNavidromeSharingEnabled(false);
    const firstServerId = useAuthStore.getState().activeServerId!;
    const secondServerId = useAuthStore.getState().addServer({
      name: 'Second', url: 'https://second.test', username: 'u2', password: 'p2',
    });
    seedQueue([
      makeTrack({ id: 'first', serverId: firstServerId }),
      makeTrack({ id: 'second', serverId: secondServerId }),
    ], { serverId: firstServerId });

    const { getByLabelText, getByRole } = renderWithProviders(<QueuePanel />);
    fireEvent.click(getByLabelText('Copy queue share link'));
    const menu = getByRole('menu', { name: 'Copy queue share link' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Second' }));

    await waitFor(() => expect(copyTextToClipboardMock).toHaveBeenCalledOnce());
    expect(decodeSharePayloadFromText(copyTextToClipboardMock.mock.calls[0]![0])).toEqual({
      srv: 'https://second.test',
      k: 'queue',
      ids: ['second'],
    });
  });
});
