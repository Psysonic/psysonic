import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '@/lib/media/trackTypes';
import { offlineActionPolicy } from '@/features/offline';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import type { ContextMenuItemsProps } from './contextMenuItemTypes';
import MultiSongContextItems from './MultiSongContextItems';

const queueSongStar = vi.hoisted(() => vi.fn());
vi.mock('@/features/playback', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/playback')>()),
  queueSongStar: (...args: unknown[]) => queueSongStar(...args),
}));

const track = (id: string, overrides: Partial<Track> = {}): Track => ({
  id,
  serverId: 'srv',
  title: id,
  artist: 'Artist',
  album: 'Album',
  duration: 60,
  userRating: 0,
  ...overrides,
} as Track);

function renderMenu(songs: Track[], overrides: Partial<ContextMenuItemsProps> = {}) {
  const spies = {
    applySongRating: vi.fn(),
    playTrack: vi.fn(),
    playNext: vi.fn(),
    enqueue: vi.fn(),
  };
  const props = {
    type: 'multi-song',
    item: songs,
    userRatingOverrides: {},
    setKeyboardRating: vi.fn(),
    keyboardRating: null,
    closeContextMenu: vi.fn(),
    playlistSubmenuOpen: false,
    setPlaylistSubmenuOpen: vi.fn(),
    cancelPlaylistSubmenuCloseTimer: vi.fn(),
    onPlaylistSubmenuTriggerMouseLeave: vi.fn(),
    playlistSongIds: [],
    setPlaylistSongIds: vi.fn(),
    handleAction: (action: () => void | Promise<void>) => action(),
    isStarred: (_id: string, itemStarred?: string) => Boolean(itemStarred),
    offlinePolicy: offlineActionPolicy('contextMenuSong', false),
    ...spies,
    ...overrides,
  } as unknown as ContextMenuItemsProps;
  renderWithProviders(<MultiSongContextItems {...props} />);
  return spies;
}

describe('MultiSongContextItems', () => {
  it('keeps the playback actions the single-track menu offers', async () => {
    const user = userEvent.setup();
    const songs = [track('a'), track('b')];
    const { playTrack, playNext, enqueue } = renderMenu(songs);

    await user.click(screen.getByText('Play Now'));
    await user.click(screen.getByText('Play Next'));
    await user.click(screen.getByText('Add to Queue'));

    expect(playTrack).toHaveBeenCalledWith(songs[0], songs, true);
    expect(playNext).toHaveBeenCalledWith(songs);
    expect(enqueue).toHaveBeenCalledWith(songs);
  });

  it('rates the whole selection from one star click', async () => {
    const user = userEvent.setup();
    const songs = [track('a'), track('b'), track('c')];
    const { applySongRating } = renderMenu(songs);

    await user.click(screen.getAllByRole('radio')[1]);

    expect(applySongRating).toHaveBeenCalledTimes(3);
    expect(applySongRating.mock.calls.map(call => call[1])).toEqual([2, 2, 2]);
  });

  it('favourites the whole selection while any row is still unfavourited', async () => {
    const user = userEvent.setup();
    queueSongStar.mockClear();
    const songs = [track('a', { starred: '2026-01-01T00:00:00Z' }), track('b')];
    renderMenu(songs);

    await user.click(screen.getByText('Favorite'));

    expect(queueSongStar).toHaveBeenCalledTimes(2);
    expect(queueSongStar.mock.calls.map(call => call[1])).toEqual([true, true]);
  });

  it('unfavourites when every row is already a favourite', async () => {
    const user = userEvent.setup();
    queueSongStar.mockClear();
    const starred = '2026-01-01T00:00:00Z';
    renderMenu([track('a', { starred }), track('b', { starred })]);

    await user.click(screen.getByText('Remove from Favorites'));

    expect(queueSongStar.mock.calls.map(call => call[1])).toEqual([false, false]);
  });

  it('hides add-to-playlist for a selection spanning two servers', () => {
    renderMenu([track('a'), track('b', { serverId: 'other' })]);
    expect(screen.queryByText('Add to Playlist')).not.toBeInTheDocument();
  });

  it('names how many tracks the menu acts on', () => {
    renderMenu([track('a'), track('b')]);
    expect(screen.getByText('2 tracks selected')).toBeInTheDocument();
  });

  it('hides the server-writing entries while offline browse forbids them', () => {
    renderMenu([track('a'), track('b')], {
      offlinePolicy: offlineActionPolicy('contextMenuSong', true),
    });
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByText('Add to Playlist')).not.toBeInTheDocument();
    expect(screen.getByText('Play Now')).toBeInTheDocument();
  });
});
