import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { flushMusicLibraryFilterVersionBumpForTests } from '@/store/musicLibraryFilterNotify';

function setUpActiveServer(): string {
  const id = useAuthStore.getState().addServer({
    name: 'Test',
    url: 'https://music.example.com',
    username: 'alice',
    password: 'pw',
  });
  useAuthStore.getState().setActiveServer(id);
  return id;
}

beforeEach(() => {
  resetAuthStore();
});

describe('setMusicLibrarySelection', () => {
  it('writes ordered selection, mirrors legacy, and bumps version after defer', () => {
    const serverId = setUpActiveServer();
    useAuthStore.getState().setMusicLibrarySelection(['lib-b', 'lib-a']);
    const state = useAuthStore.getState();
    expect(state.musicLibrarySelectionByServer[serverId]).toEqual(['lib-b', 'lib-a']);
    expect(state.musicLibraryFilterByServer[serverId]).toBe('lib-b');
    expect(state.musicLibraryFilterVersion).toBe(0);
    flushMusicLibraryFilterVersionBumpForTests();
    expect(useAuthStore.getState().musicLibraryFilterVersion).toBe(1);
  });

  it('maps empty selection to legacy all', () => {
    const serverId = setUpActiveServer();
    useAuthStore.getState().setMusicLibrarySelection([]);
    const state = useAuthStore.getState();
    expect(state.musicLibrarySelectionByServer[serverId]).toEqual([]);
    expect(state.musicLibraryFilterByServer[serverId]).toBe('all');
  });

  it('maps single selection to legacy folder id', () => {
    const serverId = setUpActiveServer();
    useAuthStore.getState().setMusicLibrarySelection(['lib-1']);
    expect(useAuthStore.getState().musicLibraryFilterByServer[serverId]).toBe('lib-1');
  });

  it('collapses to all when the selection covers every folder', () => {
    const serverId = setUpActiveServer();
    useAuthStore.setState({
      musicFolders: [
        { id: 'lib-a', name: 'A' },
        { id: 'lib-b', name: 'B' },
      ],
    });
    useAuthStore.getState().setMusicLibrarySelection(['lib-a', 'lib-b']);
    const state = useAuthStore.getState();
    expect(state.musicLibrarySelectionByServer[serverId]).toEqual([]);
    expect(state.musicLibraryFilterByServer[serverId]).toBe('all');
  });

  it('keeps a partial selection when not all folders are covered', () => {
    const serverId = setUpActiveServer();
    useAuthStore.setState({
      musicFolders: [
        { id: 'lib-a', name: 'A' },
        { id: 'lib-b', name: 'B' },
      ],
    });
    useAuthStore.getState().setMusicLibrarySelection(['lib-a']);
    expect(useAuthStore.getState().musicLibrarySelectionByServer[serverId]).toEqual(['lib-a']);
  });
});

describe('setMusicFolders', () => {
  it('prunes stale selection entries and syncs legacy', () => {
    const serverId = setUpActiveServer();
    useAuthStore.setState({
      musicLibrarySelectionByServer: { [serverId]: ['gone', 'keep'] },
      musicLibraryFilterByServer: { [serverId]: 'gone' },
    });
    useAuthStore.getState().setMusicFolders([{ id: 'keep', name: 'Keep' }]);
    const state = useAuthStore.getState();
    expect(state.musicLibrarySelectionByServer[serverId]).toEqual(['keep']);
    expect(state.musicLibraryFilterByServer[serverId]).toBe('keep');
  });

  it('resets legacy filter to all when the single folder is gone', () => {
    const serverId = setUpActiveServer();
    useAuthStore.setState({
      musicLibraryFilterByServer: { [serverId]: 'gone' },
    });
    useAuthStore.getState().setMusicFolders([{ id: 'new', name: 'New' }]);
    expect(useAuthStore.getState().musicLibraryFilterByServer[serverId]).toBe('all');
  });
});

describe('Library browse scope', () => {
  it('supports exclusive row selection separately from additive checkboxes', () => {
    const a = useAuthStore.getState().addServer({
      name: 'A', url: 'https://a.test', username: 'u', password: 'p',
    });
    const b = useAuthStore.getState().addServer({
      name: 'B', url: 'https://b.test', username: 'u', password: 'p',
    });
    useAuthStore.getState().setLibraryBrowseServerSelected(b, true);
    expect(useAuthStore.getState().libraryBrowseServerIds).toEqual([a, b]);

    useAuthStore.getState().setLibraryBrowseServerExclusive(b);
    expect(useAuthStore.getState().libraryBrowseServerIds).toEqual([b]);
  });

  it('selects servers in saved server order and prevents an empty scope', () => {
    const a = useAuthStore.getState().addServer({
      name: 'A', url: 'https://a.test', username: 'u', password: 'p',
    });
    const b = useAuthStore.getState().addServer({
      name: 'B', url: 'https://b.test', username: 'u', password: 'p',
    });

    useAuthStore.getState().setLibraryBrowseServerSelected(b, true);
    expect(useAuthStore.getState().libraryBrowseServerIds).toEqual([a, b]);
    useAuthStore.getState().setLibraryBrowseServerSelected(a, false);
    useAuthStore.getState().setLibraryBrowseServerSelected(b, false);
    expect(useAuthStore.getState().libraryBrowseServerIds).toEqual([b]);
  });

  it('stores and collapses a full per-server folder selection', () => {
    const serverId = setUpActiveServer();
    useAuthStore.getState().setMusicFoldersForServer(serverId, [
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
    ]);
    useAuthStore.getState().setLibraryBrowseSelectionForServer(serverId, ['two']);
    expect(useAuthStore.getState().libraryBrowseSelectionByServer[serverId]).toEqual(['two']);
    expect(useAuthStore.getState().musicLibrarySelectionByServer[serverId]).toEqual(['two']);
    expect(useAuthStore.getState().musicLibraryFilterByServer[serverId]).toBe('two');
    useAuthStore.getState().setLibraryBrowseSelectionForServer(serverId, ['two', 'one']);
    expect(useAuthStore.getState().libraryBrowseSelectionByServer[serverId]).toEqual([]);
    expect(useAuthStore.getState().musicLibrarySelectionByServer[serverId]).toEqual([]);
    expect(useAuthStore.getState().musicLibraryFilterByServer[serverId]).toBe('all');
  });

  it('repairs an unchanged All libraries selection with a stale audiobook legacy filter', () => {
    const serverId = setUpActiveServer();
    useAuthStore.setState({
      musicLibrarySelectionByServer: { [serverId]: [] },
      musicLibraryFilterByServer: { [serverId]: 'audiobooks' },
    });

    useAuthStore.getState().setLibraryBrowseSelectionForServer(serverId, []);

    expect(useAuthStore.getState().musicLibraryFilterByServer[serverId]).toBe('all');
    expect(useAuthStore.getState().musicLibrarySelectionByServer[serverId]).toEqual([]);
  });

  it('prunes disappeared folders in both the sidebar and legacy selection', () => {
    const serverId = setUpActiveServer();
    useAuthStore.getState().setMusicFoldersForServer(serverId, [
      { id: 'music', name: 'Music' }, { id: 'books', name: 'Books' }, { id: 'other', name: 'Other' },
    ]);
    useAuthStore.getState().setLibraryBrowseSelectionForServer(serverId, ['music', 'books']);
    useAuthStore.getState().setMusicFoldersForServer(serverId, [{ id: 'books', name: 'Books' }, { id: 'other', name: 'Other' }]);

    const state = useAuthStore.getState();
    expect(state.libraryBrowseSelectionByServer[serverId]).toEqual(['books']);
    expect(state.musicLibrarySelectionByServer[serverId]).toEqual(['books']);
    expect(state.musicLibraryFilterByServer[serverId]).toBe('books');
  });

  it('repairs an empty server scope before storing a folder selection', () => {
    const serverId = setUpActiveServer();
    useAuthStore.getState().setMusicFoldersForServer(serverId, [
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
    ]);
    useAuthStore.setState({ libraryBrowseServerIds: [] });

    useAuthStore.getState().setLibraryBrowseSelectionForServer(serverId, ['two']);

    const state = useAuthStore.getState();
    expect(state.libraryBrowseServerIds).toEqual([serverId]);
    expect(state.libraryBrowseSelectionByServer[serverId]).toEqual(['two']);
  });
});
