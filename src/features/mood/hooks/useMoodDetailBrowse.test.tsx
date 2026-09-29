import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearMoodDetailReturnStash,
  peekMoodDetailReturnStash,
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

  it('stashes the track scroll snapshot when leaving for artist detail', () => {
    const scrollSnapshotRef: {
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
          scrollSnapshotRef,
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
  });
});
