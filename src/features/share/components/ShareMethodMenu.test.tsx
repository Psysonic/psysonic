import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import {
  ShareMethodMenuButton,
  ShareMethodMenuContent,
  ShareMethodSubmenu,
} from '@/features/share/components/ShareMethodMenu';
import { useAuthStore } from '@/store/authStore';
import { resetAllStores } from '@/test/helpers/storeReset';
import { _resetShareStoreForTest, useShareStore } from '@/features/share/store/shareStore';

const copyTextToClipboardMock = vi.fn(async (_text: string) => true);
const createShareMock = vi.fn(async (_serverId: string, _ids: readonly string[]) => ({
  id: 'share-1',
  url: 'https://music.test/share/share-1',
}));

vi.mock('@/lib/server/serverMagicString', () => ({
  copyTextToClipboard: (text: string) => copyTextToClipboardMock(text),
}));

describe('ShareMethodMenuContent', () => {
  let serverId: string;

  beforeEach(() => {
    resetAllStores();
    _resetShareStoreForTest();
    copyTextToClipboardMock.mockClear();
    createShareMock.mockClear();
    serverId = useAuthStore.getState().addServer({
      name: 'Navidrome', url: 'https://music.test', username: 'u', password: 'p',
    });
    useAuthStore.getState().setSubsonicServerIdentity(serverId, {
      type: 'navidrome',
      serverVersion: '0.64.0',
    });
    useShareStore.setState({
      createShare: createShareMock,
      byServer: {
        [serverId]: {
          shares: [],
          loading: false,
          lastSuccessfulRefresh: Date.now(),
          availability: 'available',
        },
      },
    });
  });

  it('sends a playlist as its single native ID', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <div role="menu">
        <ShareMethodMenuContent
          request={{ kind: 'playlist', resourceIds: ['playlist-native-id'], serverIds: [serverId] }}
          onDone={vi.fn()}
        />
      </div>,
    );

    await user.click(screen.getByRole('menuitem', { name: 'Navidrome' }));
    expect(createShareMock).toHaveBeenCalledWith(serverId, ['playlist-native-id']);
    expect(copyTextToClipboardMock).toHaveBeenCalledWith('https://music.test/share/share-1');
  });

  it('keeps composer Navidrome sharing disabled with a separate accessible help popover', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <div role="menu">
        <ShareMethodMenuContent
          request={{ kind: 'composer', resourceIds: ['composer-1'], serverIds: [serverId] }}
          onDone={vi.fn()}
        />
      </div>,
    );

    expect(screen.getByRole('menuitem', { name: 'Navidrome' })).toHaveAttribute('aria-disabled', 'true');
    const help = screen.getByRole('button', { name: 'Why Navidrome is unavailable' });
    await user.click(help);
    expect(screen.getByRole('dialog')).toHaveTextContent('Composer links cannot be shared with this method.');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(help).toHaveFocus();

    await user.click(help);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('positions a context submenu beside its parent instead of over it', () => {
    renderWithProviders(
      <ShareMethodSubmenu
        triggerId="share"
        request={{ kind: 'track', resourceIds: ['track-1'], serverIds: [serverId] }}
        onDone={vi.fn()}
      />,
    );

    expect(screen.getByRole('menu')).toHaveStyle({ left: '100%', right: 'auto' });
  });

  it('opens the two-method menu from a share button on right click', () => {
    renderWithProviders(
      <ShareMethodMenuButton
        label="Share queue"
        className="share-button"
        request={{ kind: 'queue', resourceIds: ['track-1'], serverIds: [serverId] }}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Share queue' }));

    expect(screen.getByRole('menu', { name: 'Share queue' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.getByRole('menuitem', { name: 'Psysonic' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Navidrome' })).toBeInTheDocument();
  });
});
