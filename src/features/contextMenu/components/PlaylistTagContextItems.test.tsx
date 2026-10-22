import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlaylistTagContextItems from '@/features/contextMenu/components/PlaylistTagContextItems';
import type { ContextMenuItemsProps } from '@/features/contextMenu/components/contextMenuItemTypes';
import { usePlaylistTagStore } from '@/features/playlist';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

function renderItems(name: string, closeContextMenu = vi.fn()) {
  const props = { type: 'playlist-tag', item: { name }, closeContextMenu } as unknown as ContextMenuItemsProps;
  return { view: renderWithProviders(<PlaylistTagContextItems {...props} />), closeContextMenu };
}

describe('PlaylistTagContextItems', () => {
  beforeEach(() => {
    usePlaylistTagStore.setState({
      byServer: { s1: { p1: ['Chill'], p2: ['Chill', 'Relax'] } },
      activeFilter: [],
    });
  });

  it('renames the tag inline and closes the menu', async () => {
    const user = userEvent.setup();
    const { view, closeContextMenu } = renderItems('Chill');

    await user.click(view.getByText('Rename tag'));
    const input = view.getByRole('textbox', { name: 'Rename tag' });
    await user.clear(input);
    await user.type(input, 'relax{Enter}');

    expect(usePlaylistTagStore.getState().byServer).toEqual({ s1: { p1: ['Relax'], p2: ['Relax'] } });
    expect(closeContextMenu).toHaveBeenCalled();
  });

  it('asks for a second click before removing the tag from all playlists', async () => {
    const user = userEvent.setup();
    const { view, closeContextMenu } = renderItems('Chill');

    await user.click(view.getByText('Delete tag'));
    expect(usePlaylistTagStore.getState().byServer.s1.p1).toEqual(['Chill']);
    expect(closeContextMenu).not.toHaveBeenCalled();

    await user.click(view.getByText('Click again to remove it from all playlists'));
    expect(usePlaylistTagStore.getState().byServer).toEqual({ s1: { p2: ['Relax'] } });
    expect(closeContextMenu).toHaveBeenCalled();
  });
});
