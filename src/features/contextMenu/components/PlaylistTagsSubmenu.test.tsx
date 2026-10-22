import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import PlaylistTagsSubmenu from '@/features/contextMenu/components/PlaylistTagsSubmenu';
import { usePlaylistTagStore } from '@/features/playlist';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

const target = (playlistId: string, serverId = 's1') => ({ serverId, playlistId });
const tagsOf = (playlistId: string, serverId = 's1') =>
  usePlaylistTagStore.getState().byServer[serverId]?.[playlistId] ?? [];

describe('PlaylistTagsSubmenu', () => {
  beforeEach(() => {
    usePlaylistTagStore.setState({ byServer: {}, activeFilter: [] });
  });

  it('creates a new tag on the playlist and stays open for the next one', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<PlaylistTagsSubmenu targets={[target('p1')]} />);

    await user.click(view.getByText('New tag'));
    await user.type(view.getByRole('textbox', { name: 'New tag' }), 'Chill{Enter}');

    expect(tagsOf('p1')).toEqual(['Chill']);
    expect(view.getByRole('menuitemcheckbox', { name: 'Chill' })).toHaveAttribute('aria-checked', 'true');
    expect(view.getByText('New tag')).toBeInTheDocument();
  });

  it('toggles a known tag on and off', async () => {
    const user = userEvent.setup();
    usePlaylistTagStore.setState({ byServer: { s2: { other: ['Summer'] } } });
    const view = renderWithProviders(<PlaylistTagsSubmenu targets={[target('p1')]} />);
    const item = view.getByRole('menuitemcheckbox', { name: 'Summer' });

    expect(item).toHaveAttribute('aria-checked', 'false');
    await user.click(item);
    expect(tagsOf('p1')).toEqual(['Summer']);
    await user.click(view.getByRole('menuitemcheckbox', { name: 'Summer' }));
    expect(tagsOf('p1')).toEqual([]);
  });

  it('shows a tag some of the selection carries as mixed and gives it to all on click', async () => {
    const user = userEvent.setup();
    usePlaylistTagStore.setState({ byServer: { s1: { p1: ['Chill'] } } });
    const view = renderWithProviders(
      <PlaylistTagsSubmenu targets={[target('p1'), target('p2'), target('p3', 's2')]} />,
    );

    expect(view.getByRole('menuitemcheckbox', { name: 'Chill' })).toHaveAttribute('aria-checked', 'mixed');
    await user.click(view.getByRole('menuitemcheckbox', { name: 'Chill' }));

    expect(tagsOf('p1')).toEqual(['Chill']);
    expect(tagsOf('p2')).toEqual(['Chill']);
    expect(tagsOf('p3', 's2')).toEqual(['Chill']);
    expect(view.getByRole('menuitemcheckbox', { name: 'Chill' })).toHaveAttribute('aria-checked', 'true');

    await user.click(view.getByRole('menuitemcheckbox', { name: 'Chill' }));
    expect(usePlaylistTagStore.getState().byServer).toEqual({});
  });
});
