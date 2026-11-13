import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { samplePlaylist } from '@/test/mocks/subsonic';

const coverProps = vi.hoisted(() => [] as Array<{ displayCssPx?: number }>);
vi.mock('@/features/playlist/components/PlaylistCoverImages', () => ({
  PlaylistCardMainCover: (props: { displayCssPx?: number }) => {
    coverProps.push(props);
    return null;
  },
  PlaylistSmartCoverCell: () => null,
}));
vi.mock('@/lib/dnd/DragDropContext', () => ({ useDragSource: () => ({}) }));
vi.mock('@/features/playback', () => ({
  NowPlayingMarker: () => null,
  useIsNowPlaying: () => false,
}));

import PlaylistCard from './PlaylistCard';

function renderCard(coverCssPx?: number) {
  coverProps.length = 0;
  render(
    <MemoryRouter>
      <PlaylistCard
        pl={samplePlaylist}
        selectionMode={false}
        selectedIds={new Set()}
        selectedPlaylists={[]}
        toggleSelect={vi.fn()}
        isPlaylistDeletable={() => false}
        deleteConfirmId={null}
        setDeleteConfirmId={vi.fn()}
        handleOpenSmartEditor={vi.fn()}
        handleDelete={vi.fn()}
        handlePlay={vi.fn()}
        playingId={null}
        smartCoverIdsByPlaylist={{}}
        pendingSmart={[]}
        filteredSongCountByPlaylist={{}}
        filteredDurationByPlaylist={{}}
        coverCssPx={coverCssPx}
      />
    </MemoryRouter>,
  );
  return coverProps[coverProps.length - 1];
}

describe('PlaylistCard cover size', () => {
  it('sizes the cover from the measured grid cell', () => {
    expect(renderCard(312)?.displayCssPx).toBe(312);
  });

  it('leaves the cover default in place before the grid has measured', () => {
    expect(renderCard(0)?.displayCssPx).toBeUndefined();
    expect(renderCard()?.displayCssPx).toBeUndefined();
  });
});
