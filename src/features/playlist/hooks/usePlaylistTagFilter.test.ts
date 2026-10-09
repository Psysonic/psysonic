import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePlaylistTagFilter } from '@/features/playlist/hooks/usePlaylistTagFilter';
import { usePlaylistTagStore } from '@/features/playlist/store/playlistTagStore';

describe('usePlaylistTagFilter', () => {
  beforeEach(() => {
    usePlaylistTagStore.setState({
      byServer: { s1: { p1: ['Chill'] }, s2: { p9: ['Road'] } },
      activeFilter: ['chill', 'road'],
    });
  });

  it('offers only the tags of the loaded playlists', () => {
    const { result } = renderHook(() => usePlaylistTagFilter([{ id: 'p1', serverId: 's1' }]));
    expect(result.current.availableTags).toEqual(['Chill']);
  });

  it('ignores a remembered chip whose tag no loaded playlist carries', () => {
    // `Road` lives on a server outside the current scope: keeping it active would
    // empty the page with no chip on screen to switch it off.
    const { result } = renderHook(() => usePlaylistTagFilter([{ id: 'p1', serverId: 's1' }]));
    expect(result.current.activeKeys).toEqual(['chill']);
    expect(usePlaylistTagStore.getState().activeFilter).toEqual(['chill', 'road']);
  });
});
