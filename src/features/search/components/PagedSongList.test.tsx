import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { useThemeStore } from '@/store/themeStore';

const enqueueAndPlayMock = vi.fn();

vi.mock('@/features/playback/utils/playback/playSong', () => ({
  enqueueAndPlay: (...args: unknown[]) => enqueueAndPlayMock(...args),
}));

import PagedSongList from './PagedSongList';

const songs = [
  makeSubsonicSong({ id: 'song-1', title: 'First song' }),
  makeSubsonicSong({ id: 'song-2', title: 'Second song' }),
];

function renderList() {
  renderWithProviders(
    <PagedSongList songs={songs} hasMore={false} loadingMore={false} onLoadMore={() => {}} />,
  );
  const row = (title: string) => screen.getByText(title).closest<HTMLElement>('.song-list-row')!;
  const list = document.querySelector<HTMLElement>('[data-track-cursor-list]')!;
  return { row, list };
}

describe('PagedSongList row click to play', () => {
  beforeEach(() => {
    enqueueAndPlayMock.mockReset();
  });

  afterEach(() => {
    useThemeStore.setState({ trackRowPlayClick: 'single' });
  });

  it('plays a row on a single click by default', () => {
    const { row } = renderList();
    fireEvent.click(row('Second song'));
    expect(enqueueAndPlayMock).toHaveBeenCalledOnce();
    expect(enqueueAndPlayMock).toHaveBeenCalledWith(songs[1]);
  });

  it('plays a habitual double click only once in single-click mode', () => {
    const { row } = renderList();
    fireEvent.click(row('Second song'), { detail: 1 });
    fireEvent.click(row('Second song'), { detail: 2 });
    fireEvent.doubleClick(row('Second song'), { detail: 2 });
    expect(enqueueAndPlayMock).toHaveBeenCalledOnce();
  });

  it('marks on a single click and plays on a double click in double-click mode', () => {
    useThemeStore.setState({ trackRowPlayClick: 'double' });
    const { row } = renderList();

    fireEvent.click(row('Second song'));
    expect(enqueueAndPlayMock).not.toHaveBeenCalled();
    expect(row('Second song')).toHaveClass('song-list-row--cursor');

    fireEvent.doubleClick(row('Second song'));
    expect(enqueueAndPlayMock).toHaveBeenCalledOnce();
    expect(enqueueAndPlayMock).toHaveBeenCalledWith(songs[1]);
  });

  it('plays the marked row with Enter after moving with the arrow keys', () => {
    useThemeStore.setState({ trackRowPlayClick: 'double' });
    const { row, list } = renderList();

    fireEvent.click(row('First song'));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(row('Second song')).toHaveClass('song-list-row--cursor');

    fireEvent.keyDown(list, { key: 'Enter' });
    expect(enqueueAndPlayMock).toHaveBeenCalledOnce();
    expect(enqueueAndPlayMock).toHaveBeenCalledWith(songs[1]);
  });
});
