import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeSubsonicSong } from '@/test/helpers/factories';

vi.mock('@/features/playback/utils/playback/playSong', () => ({
  enqueueAndPlay: vi.fn(),
}));

import PagedSongList from './PagedSongList';

const songs = [
  makeSubsonicSong({ id: 'song-1', title: 'First song', artist: 'Band A', album: 'Rec', genre: 'Rock', bpm: 120 }),
  makeSubsonicSong({ id: 'song-2', title: 'Second song', artist: 'Band B', album: 'Rec', genre: 'Pop', bpm: 90 }),
];

function renderList(showBpm = false) {
  return renderWithProviders(
    <PagedSongList songs={songs} hasMore={false} loadingMore={false} onLoadMore={() => {}} showBpm={showBpm} />,
  );
}

const headKeys = (container: HTMLElement) =>
  [...container.querySelectorAll('.tl-header .tl-head-cell')].map(c => c.getAttribute('data-tl-col'));

describe('PagedSongList — spreadsheet model', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('puts the list into the sideways-scrolling viewport', () => {
    const { container } = renderList();
    expect(container.querySelector('.tl-viewport .tl-head-clip .tl-header')).not.toBeNull();
    expect(container.querySelectorAll('.tl-viewport .tl-body .song-list-row')).toHaveLength(2);
  });

  it('lays every row cell out like its header cell', () => {
    const { container } = renderList();
    expect(headKeys(container)).toEqual(['actions', 'title', 'artist', 'album', 'genre', 'duration']);
    const row = container.querySelector('.tl-body .song-list-row')!;
    expect([...row.children].map(c => c.getAttribute('data-tl-col'))).toEqual(headKeys(container));
  });

  it('shows the BPM column only where the page asks for it', () => {
    const { container } = renderList(true);
    expect(headKeys(container)).toContain('bpm');
  });

  it('does not sort by header', () => {
    const { container } = renderList();
    expect(container.querySelector('.tl-head-cell--sortable')).toBeNull();
  });

  it('marks the text cells for measuring and tooltips, with no native tooltips', () => {
    renderList();
    const titleCell = screen.getByText('Second song').closest('.tl-cell')!;
    expect(titleCell).toHaveAttribute('data-tl-text', 'Second song');
    expect(titleCell.querySelector('[title]')).toBeNull();
    expect(titleCell).not.toHaveAttribute('title');
  });
});
