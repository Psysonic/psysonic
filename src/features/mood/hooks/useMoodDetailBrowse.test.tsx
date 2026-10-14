import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearMoodDetailReturnStash,
  clearMoodDetailTabScrollSnapshots,
  peekMoodDetailReturnStash,
  peekMoodDetailTabScrollSnapshots,
  stashMoodDetailTabScrollSnapshots,
  type AlbumBrowseScrollSnapshot,
} from '@/features/album';

import { useMoodDetailBrowse } from './useMoodDetailBrowse';

function RouterWrapper({
  children,
}: {
  children: ReactNode;
}) {
  return <BrowserRouter>{children}</BrowserRouter>;
}

describe('useMoodDetailBrowse', () => {
  beforeEach(() => {
    clearMoodDetailReturnStash(
      'srv-1',
      'Dreamy',
    );
    clearMoodDetailTabScrollSnapshots(
      'srv-1',
      'Dreamy',
    );
    window.history.replaceState(
      {},
      '',
      '/moods/Dreamy?view=tracks',
    );
  });

  afterEach(() => {
    clearMoodDetailReturnStash(
      'srv-1',
      'Dreamy',
    );
    clearMoodDetailTabScrollSnapshots(
      'srv-1',
      'Dreamy',
    );
    window.history.replaceState({}, '', '/');
  });

  it('records the Tracks tab as the owner of the restore display count', () => {
    const scrollSnapshotRef = {
      current: {
        scrollTop: 0,
        displayCount: 0,
      },
    };

    const { result } = renderHook(
      () =>
        useMoodDetailBrowse(
          'srv-1',
          'Dreamy',
          scrollSnapshotRef,
        ),
      { wrapper: RouterWrapper },
    );

    expect(result.current.restoreView).toBe(
      'tracks',
    );
  });

  it('stashes both tab scroll snapshots when leaving for artist detail', () => {
    const albumScrollSnapshotRef: {
      current: AlbumBrowseScrollSnapshot;
    } = {
      current: {
        scrollTop: 320,
        displayCount: 120,
      },
    };
    const trackScrollSnapshotRef: {
      current: AlbumBrowseScrollSnapshot;
    } = {
      current: {
        scrollTop: 640,
        displayCount: 275,
      },
    };

    const { unmount } = renderHook(
      () =>
        useMoodDetailBrowse(
          'srv-1',
          'Dreamy',
          trackScrollSnapshotRef,
          albumScrollSnapshotRef,
          trackScrollSnapshotRef,
        ),
      { wrapper: RouterWrapper },
    );

    window.history.pushState(
      {},
      '',
      '/artist/artist-1',
    );

    unmount();

    expect(
      peekMoodDetailReturnStash(
        'srv-1',
        'Dreamy',
      ),
    ).toMatchObject({
      scrollTop: 640,
      displayCount: 275,
    });
    expect(
      peekMoodDetailTabScrollSnapshots(
        'srv-1',
        'Dreamy',
      ),
    ).toEqual({
      albums: {
        scrollTop: 320,
        displayCount: 120,
      },
      tracks: {
        scrollTop: 640,
        displayCount: 275,
      },
    });
  });

  it('restores both tab snapshots for the returned mood session', () => {
    stashMoodDetailTabScrollSnapshots(
      'srv-1',
      'Dreamy',
      {
        albums: {
          scrollTop: 410,
          displayCount: 180,
        },
        tracks: {
          scrollTop: 880,
          displayCount: 360,
        },
      },
    );

    const { result } = renderHook(
      () =>
        useMoodDetailBrowse(
          'srv-1',
          'Dreamy',
        ),
      { wrapper: RouterWrapper },
    );

    expect(
      result.current.restoreTabScrollSnapshots,
    ).toEqual({
      albums: {
        scrollTop: 410,
        displayCount: 180,
      },
      tracks: {
        scrollTop: 880,
        displayCount: 360,
      },
    });
  });
});
