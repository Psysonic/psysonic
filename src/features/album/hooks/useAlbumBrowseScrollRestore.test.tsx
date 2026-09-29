import type { ReactNode } from 'react';
import {
  renderHook,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  DEFAULT_ALBUM_BROWSE_RETURN_FILTERS,
  peekMoodDetailReturnStash,
  stashMoodDetailReturnFilters,
} from '@/features/album/store/albumBrowseSessionStore';

import { useAlbumBrowseScrollRestore } from './useAlbumBrowseScrollRestore';

function RouterWrapper({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/moods/Dreamy',
          state: {
            albumBrowseRestore: true,
          },
        },
      ]}
    >
      {children}
    </MemoryRouter>
  );
}

describe('useAlbumBrowseScrollRestore', () => {
  it('restores mood detail scroll after enough albums are loaded', async () => {
    stashMoodDetailReturnFilters(
      'srv-1',
      'Dreamy',
      {
        ...DEFAULT_ALBUM_BROWSE_RETURN_FILTERS,
        scrollTop: 640,
        displayCount: 120,
      },
    );

    const scrollBodyEl =
      document.createElement('div');

    const loadMore = vi.fn();

    const {
      result,
      rerender,
    } = renderHook(
      ({
        displayAlbumsLength,
        hasMore,
      }) =>
        useAlbumBrowseScrollRestore({
          serverId: 'srv-1',
          moodName: 'Dreamy',
          scrollBodyEl,
          displayAlbumsLength,
          loading: false,
          loadingMore: false,
          hasMore,
          loadMore,
        }),
      {
        wrapper: RouterWrapper,
        initialProps: {
          displayAlbumsLength: 60,
          hasMore: true,
        },
      },
    );

    expect(
      result.current.isScrollRestorePending,
    ).toBe(true);

    await waitFor(() => {
      expect(loadMore).toHaveBeenCalled();
    });

    rerender({
      displayAlbumsLength: 120,
      hasMore: false,
    });

    await waitFor(() => {
      expect(scrollBodyEl.scrollTop).toBe(
        640,
      );
    });

    await waitFor(() => {
      expect(
        result.current
          .isScrollRestorePending,
      ).toBe(false);
    });

    expect(
      peekMoodDetailReturnStash(
        'srv-1',
        'Dreamy',
      ),
    ).toBeNull();
  });
});