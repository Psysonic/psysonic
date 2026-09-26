import { getPlaylistForServer } from '@/lib/api/subsonicPlaylists';
import { getAlbumListForServer, getMusicFoldersForServer } from '@/lib/api/subsonicLibrary';
import { librarySelectionForServer } from '@/lib/api/subsonicClient';
import { playlistDiagnosticError } from '@/lib/api/debugLog';
import { resolveServerIdForIndexKey } from '@/lib/server/serverLookup';
import { useAuthStore } from '@/store/authStore';

const PAGE_SIZE = 500;
const MAX_PAGES = 40;
const MAX_FOLDERS = 32;

interface AlbumProbe {
  ids: Set<string>;
  albums: number;
  pages: number;
  complete: boolean;
  elapsedMs: number;
  error?: ReturnType<typeof playlistDiagnosticError>;
}

async function probeAlbums(serverId: string, folderId?: string): Promise<AlbumProbe> {
  const ids = new Set<string>();
  const started = performance.now();
  let pages = 0;
  try {
    while (pages < MAX_PAGES) {
      const albums = await getAlbumListForServer(
        serverId, 'alphabeticalByName', PAGE_SIZE, pages * PAGE_SIZE,
        {}, 15000, folderId === undefined ? [] : [folderId],
      );
      pages += 1;
      for (const album of albums) ids.add(album.id);
      if (albums.length < PAGE_SIZE) {
        return { ids, albums: ids.size, pages, complete: true, elapsedMs: Math.round(performance.now() - started) };
      }
    }
    return { ids, albums: ids.size, pages, complete: false, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ids, albums: ids.size, pages, complete: false,
      elapsedMs: Math.round(performance.now() - started), error: playlistDiagnosticError(error),
    };
  }
}

/** Read-only scope comparison. Never updates selection, playlist, or offline pin state. */
export async function runPlaylistScopeDiagnostic(
  serverId: string,
  playlistId: string,
  onProgress: (message: string) => void = () => {},
): Promise<string> {
  const started = performance.now();
  const ownerId = resolveServerIdForIndexKey(serverId);
  const state = useAuthStore.getState();
  const selected = state.libraryBrowseSelectionByServer[ownerId] ?? [];
  const oldSelection = librarySelectionForServer(serverId);
  const legacy = state.musicLibraryFilterByServer[ownerId];
  const historicalSource = oldSelection.length === 1 ? 'selection'
    : legacy !== undefined && legacy !== 'all' ? 'legacy' : 'all';
  const historicalFolder = historicalSource === 'selection' ? oldSelection[0]
    : historicalSource === 'legacy' ? legacy : undefined;

  onProgress('Reading playlist and library list…');
  const { playlist, songs } = await getPlaylistForServer(serverId, playlistId);
  let folders = state.musicFoldersByServer[ownerId] ?? [];
  let folderFetchError: ReturnType<typeof playlistDiagnosticError> | null = null;
  let folderCatalogChanged = false;
  try {
    const fresh = await getMusicFoldersForServer(serverId);
    // Mirror the sidebar's stored IDs; report drift instead of changing selection.
    folderCatalogChanged = fresh.length !== folders.length
      || fresh.some(folder => !folders.some(saved => saved.id === folder.id));
    if (folders.length === 0) folders = fresh;
  } catch (error) {
    folderFetchError = playlistDiagnosticError(error);
  }

  onProgress('Testing the full album catalog…');
  const all = await probeAlbums(serverId);
  const idsToProbe = [...new Set([
    ...folders.map(folder => folder.id).slice(0, MAX_FOLDERS),
    ...selected, ...(historicalFolder ? [historicalFolder] : []),
  ])];
  // A large or tampered persisted selection must not trigger unlimited requests.
  const boundedIds = idsToProbe.slice(0, MAX_FOLDERS);
  const probes = new Map<string, AlbumProbe>();
  for (const [index, folderId] of boundedIds.entries()) {
    onProgress(`Testing library ${index + 1} of ${boundedIds.length}…`);
    probes.set(folderId, await probeAlbums(serverId, folderId));
  }

  const matching = (ids: ReadonlySet<string>) => songs.filter(song => !!song.albumId && ids.has(song.albumId)).length;
  const scoped = (selection: readonly string[], legacyFailOpen = false) => {
    if (selection.length === 0) return { shown: songs.length, complete: true };
    const entries = selection.map(id => probes.get(id));
    const ids = new Set(entries.flatMap(entry => [...(entry?.ids ?? [])]));
    return {
      shown: entries.every(entry => entry?.complete)
        ? legacyFailOpen && ids.size === 0 ? songs.length : matching(ids)
        : null,
      complete: entries.every(entry => entry?.complete),
    };
  };
  const report = {
    diagnostic: 'playlist-1664-scope-comparison', schema: 1,
    serverPlaylistCount: playlist.songCount ?? null,
    responseSongs: songs.length,
    songsWithoutAlbumId: songs.filter(song => !song.albumId).length,
    distinctSongAlbumIds: new Set(songs.map(song => song.albumId).filter(Boolean)).size,
    sidebarSelectionCount: selected.length,
    oldSelectionCount: oldSelection.length,
    legacyFilterSet: !!legacy && legacy !== 'all',
    historicalSource,
    historicalShown: scoped(historicalFolder ? [historicalFolder] : [], true),
    sidebarShown: scoped(selected),
    allLibrariesShown: songs.length,
    fullCatalog: {
      albums: all.albums, pages: all.pages, complete: all.complete,
      matchingSongs: all.complete ? matching(all.ids) : null,
      elapsedMs: all.elapsedMs, ...(all.error ? { error: all.error } : {}),
    },
    folderCount: folders.length,
    folderCatalogChanged,
    ...(folderFetchError ? { folderFetchError } : {}),
    truncatedFolders: idsToProbe.length > boundedIds.length || folders.length > MAX_FOLDERS,
    folders: boundedIds.map((id, index) => {
      const probe = probes.get(id)!;
      return {
        slot: index + 1, sidebarSelected: selected.includes(id), historicalSelected: historicalFolder === id,
        inSidebarCatalog: folders.some(folder => folder.id === id),
        albums: probe.albums, pages: probe.pages, complete: probe.complete,
        matchingSongs: probe.complete ? matching(probe.ids) : null,
        elapsedMs: probe.elapsedMs, ...(probe.error ? { error: probe.error } : {}),
      };
    }),
    elapsedMs: Math.round(performance.now() - started),
  };
  return JSON.stringify(report, null, 2);
}
