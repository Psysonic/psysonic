import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';

const mocks = vi.hoisted(() => ({
  csv: '',
  library: [] as SubsonicSong[],
  searchForServer: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => 'playlist.csv') }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn(async () => mocks.csv) }));
vi.mock('@/lib/dom/toast', () => ({ showToast: vi.fn() }));
vi.mock('@/lib/api/subsonicSearch', async () => {
  // Real guard in front of a fake server: a query the guard refuses never
  // reaches the server, exactly like the production search helpers.
  const { searchQueryIsFtsSafe } = await import('@/lib/library/searchQueryFtsSafe');
  const serverSearch = (query: string) => {
    if (!searchQueryIsFtsSafe(query)) return { artists: [], albums: [], songs: [] };
    const words = query.toLowerCase().split(/\s+/);
    const songs = mocks.library.filter(s => words.every(w => s.title.toLowerCase().includes(w)));
    return { artists: [], albums: [], songs };
  };
  mocks.searchForServer.mockImplementation(async (_serverId: string, query: string) => serverSearch(query));
  return { searchForServer: mocks.searchForServer, search: vi.fn(async (query: string) => serverSearch(query)) };
});

import { runPlaylistCsvImport } from './runPlaylistCsvImport';

function song(id: string, title: string, artist: string, album: string): SubsonicSong {
  return { id, title, artist, album, duration: 200 } as SubsonicSong;
}

async function importCsv(rows: Array<[string, string, string]>): Promise<SubsonicSong[]> {
  mocks.csv = ['Track Name,Artist Name(s),Album Name', ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
  const savePlaylist = vi.fn(async (_next: SubsonicSong[]) => {});
  await runPlaylistCsvImport({
    songs: [],
    t: ((key: string) => key) as unknown as TFunction,
    savePlaylist,
    setSongs: vi.fn(),
    setCsvImporting: vi.fn(),
    setCsvImportReport: vi.fn(),
    serverId: 'srv-a',
  });
  return (savePlaylist.mock.calls[0]?.[0] as SubsonicSong[] | undefined) ?? [];
}

describe('runPlaylistCsvImport — titles with punctuation', () => {
  beforeEach(() => {
    mocks.searchForServer.mockClear();
    mocks.library = [
      song('s1', 'Song (Part 2)', 'Band', 'Record'),
      song('s2', 'Title: The Subtitle', 'Band', 'Record'),
      song('s3', 'Rock & Roll', 'Band', 'Record'),
      song('s4', 'Anthem', 'Band', 'Record'),
    ];
  });

  it('finds tracks whose titles carry search syntax characters', async () => {
    const added = await importCsv([
      ['Song (Part 2)', 'Band', 'Record'],
      ['Title: The Subtitle', 'Band', 'Record'],
      ['Rock & Roll', 'Band', 'Record'],
    ]);
    expect(added.map(s => s.id).sort()).toEqual(['s1', 's2', 's3']);
    expect(mocks.searchForServer).toHaveBeenCalledWith('srv-a', 'Song Part 2', expect.anything());
  });

  it('strips the "- YYYY Remaster" suffix before searching', async () => {
    const added = await importCsv([['Anthem - 2011 Remaster', 'Band', 'Record']]);
    expect(added.map(s => s.id)).toEqual(['s4']);
    expect(mocks.searchForServer).toHaveBeenCalledWith('srv-a', 'Anthem', expect.anything());
  });
});
