import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlaylistTagFilterBar from '@/features/playlist/components/PlaylistTagFilterBar';
import { usePlaylistTagStore } from '@/features/playlist/store/playlistTagStore';
import { usePlayerStore } from '@/features/playback';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

const originalOpenContextMenu = usePlayerStore.getState().openContextMenu;

describe('PlaylistTagFilterBar', () => {
  beforeEach(() => {
    usePlaylistTagStore.setState({ byServer: {}, activeFilter: [] });
  });

  afterEach(() => {
    usePlayerStore.setState({ openContextMenu: originalOpenContextMenu });
  });

  it('renders nothing while no playlist carries a tag', () => {
    const view = renderWithProviders(<PlaylistTagFilterBar tags={[]} activeKeys={[]} />);
    expect(view.queryByRole('group', { name: 'Filter by tags' })).not.toBeInTheDocument();
  });

  it('switches chips on and off and tells assistive tech which are on', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(
      <PlaylistTagFilterBar tags={['Chill', 'Summer']} activeKeys={['summer']} />,
    );

    expect(view.getByRole('button', { name: 'Chill' })).toHaveAttribute('aria-pressed', 'false');
    expect(view.getByRole('button', { name: 'Summer' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(view.getByRole('button', { name: 'Chill' }));
    expect(usePlaylistTagStore.getState().activeFilter).toEqual(['chill']);
  });

  it('offers a clear button only while a chip is on', async () => {
    const user = userEvent.setup();
    usePlaylistTagStore.setState({ activeFilter: ['chill', 'summer'] });
    const view = renderWithProviders(
      <PlaylistTagFilterBar tags={['Chill', 'Summer']} activeKeys={['chill', 'summer']} />,
    );

    await user.click(view.getByRole('button', { name: 'Clear tag filter' }));
    expect(usePlaylistTagStore.getState().activeFilter).toEqual([]);

    view.rerender(<PlaylistTagFilterBar tags={['Chill', 'Summer']} activeKeys={[]} />);
    expect(view.queryByRole('button', { name: 'Clear tag filter' })).not.toBeInTheDocument();
  });

  it('opens the tag menu on right-click, also from the keyboard', () => {
    const openContextMenu = vi.fn();
    usePlayerStore.setState({ openContextMenu });
    const view = renderWithProviders(<PlaylistTagFilterBar tags={['Chill']} activeKeys={[]} />);
    const chip = view.getByRole('button', { name: 'Chill' });

    fireEvent.contextMenu(chip, { clientX: 40, clientY: 60 });
    expect(openContextMenu).toHaveBeenLastCalledWith(40, 60, { name: 'Chill' }, 'playlist-tag');

    // The context-menu key carries no pointer position; the menu opens under the chip.
    vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue({
      left: 12, bottom: 30, top: 10, right: 50, width: 38, height: 20, x: 12, y: 10, toJSON: () => ({}),
    });
    fireEvent.contextMenu(chip, { clientX: 0, clientY: 0 });
    expect(openContextMenu).toHaveBeenLastCalledWith(12, 30, { name: 'Chill' }, 'playlist-tag');
  });
});
