import { describe, expect, it } from 'vitest';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { sortArtistAlbums } from '@/features/artist/utils/sortArtistAlbums';

const album = (id: string, name: string, year?: number): SubsonicAlbum => ({
  id,
  name,
  artist: 'A',
  artistId: 'a',
  songCount: 1,
  duration: 1,
  year,
});

describe('sortArtistAlbums', () => {
  const albums = [
    album('3', 'Gamma', 2000),
    album('1', 'Alpha', 1990),
    album('2', 'Beta', 2000),
  ];

  it('sorts by year descending then name', () => {
    expect(sortArtistAlbums(albums, 'yearDesc').map(a => a.id)).toEqual(['2', '3', '1']);
  });

  it('sorts by year ascending then name', () => {
    expect(sortArtistAlbums(albums, 'yearAsc').map(a => a.id)).toEqual(['1', '2', '3']);
  });

  it('sorts by name in both directions', () => {
    expect(sortArtistAlbums(albums, 'nameAsc').map(a => a.id)).toEqual(['1', '2', '3']);
    expect(sortArtistAlbums(albums, 'nameDesc').map(a => a.id)).toEqual(['3', '2', '1']);
  });

  it('sorts numbered names naturally and ignores case', () => {
    const live = [album('10', 'Live 10'), album('2', 'live 2'), album('1', 'Live 1')];
    expect(sortArtistAlbums(live, 'nameAsc').map(a => a.id)).toEqual(['1', '2', '10']);
  });

  it('puts the newer album first when two names are equal', () => {
    const same = [album('old', 'Greatest Hits', 1995), album('new', 'Greatest Hits', 2010)];
    expect(sortArtistAlbums(same, 'nameAsc').map(a => a.id)).toEqual(['new', 'old']);
  });
});
