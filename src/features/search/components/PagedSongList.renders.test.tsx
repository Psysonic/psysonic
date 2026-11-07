import { memo } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeSubsonicSong } from '@/test/helpers/factories';

const renders = vi.hoisted(() => new Map<string, number>());

vi.mock('@/features/search/components/SongRow', () => ({
  default: memo(function CountingRow({ song, cursorRowId }: { song: { id: string; title: string }; cursorRowId?: string }) {
    renders.set(song.id, (renders.get(song.id) ?? 0) + 1);
    return <div className="song-list-row" id={cursorRowId}>{song.title}</div>;
  }),
}));
vi.mock('@/features/playback/utils/playback/playSong', () => ({ enqueueAndPlay: vi.fn() }));

import PagedSongList from './PagedSongList';

const songs = ['a', 'b', 'c', 'd'].map(id => makeSubsonicSong({ id, title: `Song ${id}` }));

describe('PagedSongList — row renders', () => {
  // Thousands of rows can be loaded: moving the cursor must only repaint the
  // two rows whose cursor state changes, not every row.
  it('re-renders only the rows the cursor leaves and enters', () => {
    renderWithProviders(<PagedSongList songs={songs} hasMore={false} loadingMore={false} onLoadMore={() => {}} />);
    const list = document.querySelector<HTMLElement>('[data-track-cursor-list]')!;
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    renders.clear();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(renders.get('a')).toBe(1);
    expect(renders.get('b')).toBe(1);
    expect(renders.has('c')).toBe(false);
    expect(renders.has('d')).toBe(false);
  });
});
