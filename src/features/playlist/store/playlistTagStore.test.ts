import { beforeEach, describe, expect, it } from 'vitest';
import { usePlaylistTagStore } from '@/features/playlist/store/playlistTagStore';

const get = () => usePlaylistTagStore.getState();
const target = (playlistId: string, serverId = 's1') => ({ serverId, playlistId });

beforeEach(() => {
  usePlaylistTagStore.setState({ byServer: {}, activeFilter: [] });
});

describe('playlistTagStore', () => {
  it('adds a tag to several playlists at once and never twice to the same one', () => {
    get().addTag([target('p1'), target('p2')], '  Chill ');
    get().addTag([target('p1')], 'chill');

    expect(get().byServer).toEqual({ s1: { p1: ['Chill'], p2: ['Chill'] } });
  });

  it('reuses the existing spelling when a known tag is typed differently', () => {
    get().addTag([target('p1')], 'Chill');
    get().addTag([target('p9', 's2')], 'CHILL');

    expect(get().byServer.s2).toEqual({ p9: ['Chill'] });
  });

  it('ignores an empty name', () => {
    get().addTag([target('p1')], '   ');
    expect(get().byServer).toEqual({});
  });

  it('removes a tag and drops entries that end up empty', () => {
    get().addTag([target('p1'), target('p2')], 'Chill');
    get().addTag([target('p1')], 'Summer');
    get().removeTag([target('p1'), target('p2')], 'chill');

    expect(get().byServer).toEqual({ s1: { p1: ['Summer'] } });
  });

  it('switches off a filter chip once no playlist carries its tag anymore', () => {
    get().addTag([target('p1'), target('p2')], 'Chill');
    get().toggleFilter('Chill');

    get().removeTag([target('p1')], 'Chill');
    expect(get().activeFilter).toEqual(['chill']);

    get().removeTag([target('p2')], 'Chill');
    expect(get().activeFilter).toEqual([]);
  });

  it('renames a tag everywhere and follows it in the filter', () => {
    get().addTag([target('p1'), target('p2', 's2')], 'Chill');
    get().toggleFilter('Chill');
    get().renameTag('chill', ' Late night ');

    expect(get().byServer).toEqual({ s1: { p1: ['Late night'] }, s2: { p2: ['Late night'] } });
    expect(get().activeFilter).toEqual(['late night']);
  });

  it('renaming onto an existing tag merges the two under the existing spelling', () => {
    get().addTag([target('p1'), target('p2')], 'Chill');
    get().addTag([target('p2'), target('p3')], 'Relax');
    get().toggleFilter('Chill');
    get().toggleFilter('Relax');
    get().renameTag('Chill', 'relax');

    expect(get().byServer).toEqual({ s1: { p1: ['Relax'], p2: ['Relax'], p3: ['Relax'] } });
    expect(get().activeFilter).toEqual(['relax']);
  });

  it('changes only the spelling when a rename differs in case', () => {
    get().addTag([target('p1')], 'chill');
    get().renameTag('chill', 'Chill');

    expect(get().byServer).toEqual({ s1: { p1: ['Chill'] } });
  });

  it('deletes a tag from every playlist and from the filter', () => {
    get().addTag([target('p1'), target('p2', 's2')], 'Chill');
    get().addTag([target('p1')], 'Summer');
    get().toggleFilter('Chill');
    get().deleteTag('CHILL');

    expect(get().byServer).toEqual({ s1: { p1: ['Summer'] } });
    expect(get().activeFilter).toEqual([]);
  });

  it('toggles filter chips by key and clears them', () => {
    get().toggleFilter('Chill');
    get().toggleFilter('Summer');
    get().toggleFilter('chill');
    expect(get().activeFilter).toEqual(['summer']);

    get().clearFilter();
    expect(get().activeFilter).toEqual([]);
  });
});
