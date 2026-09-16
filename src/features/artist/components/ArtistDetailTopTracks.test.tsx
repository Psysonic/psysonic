import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeSubsonicSong } from '@/test/helpers/factories';
import { resetAllStores } from '@/test/helpers/storeReset';

const startDrag = vi.hoisted(() => vi.fn());

vi.mock('@/lib/dnd/DragDropContext', () => ({
  useDragDrop: () => ({ startDrag, payload: null, isDragging: false }),
}));
vi.mock('@/features/artist/components/ArtistTopTrackCover', () => ({
  default: () => <div data-testid="top-track-cover" />,
}));

import ArtistDetailTopTracks from './ArtistDetailTopTracks';

describe('ArtistDetailTopTracks', () => {
  beforeEach(() => {
    resetAllStores();
    startDrag.mockReset();
  });

  afterEach(() => {
    fireEvent.mouseUp(document);
  });

  it('starts a canonical song drag for a ranked track', () => {
    const song = makeSubsonicSong({
      id: 'song-top-1',
      title: 'Ranked track',
      albumId: 'album-top-1',
      coverArt: 'cover-top-1',
      serverId: 'srv-2',
    });
    const { container } = renderWithProviders(
      <ArtistDetailTopTracks
        topSongs={[song]}
        albums={[]}
        playTopSongWithContinuation={vi.fn()}
      />,
    );
    const row = container.querySelector<HTMLElement>('.track-row:not(.artist-top-track-skeleton)');
    expect(row).toBeTruthy();

    fireEvent.mouseDown(row!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 20, clientY: 10 });

    expect(startDrag).toHaveBeenCalledOnce();
    const [payload, x, y] = startDrag.mock.calls[0]!;
    expect(JSON.parse(payload.data)).toEqual({
      type: 'song',
      track: expect.objectContaining({
        id: 'song-top-1',
        albumId: 'album-top-1',
        coverArt: 'cover-top-1',
        serverId: 'srv-2',
      }),
    });
    expect(payload.label).toBe('Ranked track');
    expect([x, y]).toEqual([20, 10]);
  });

  it('does not start a row drag from the play button', () => {
    renderWithProviders(
      <ArtistDetailTopTracks
        topSongs={[makeSubsonicSong({ title: 'Ranked track' })]}
        albums={[]}
        playTopSongWithContinuation={vi.fn()}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Play' }), {
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.mouseMove(document, { clientX: 20, clientY: 10 });

    expect(startDrag).not.toHaveBeenCalled();
  });
});
