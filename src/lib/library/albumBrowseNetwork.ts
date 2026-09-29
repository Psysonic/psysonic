import { getAlbumList, getAlbumListForServer } from '@/lib/api/subsonicLibrary';
import { getAlbumsByGenre, getAlbumsByGenreForServer } from '@/lib/api/subsonicGenres';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { dedupeById } from '@/lib/util/dedupeById';
import {
  filterAlbumsByCompilation,
  filterAlbumsByYearBounds,
} from './albumBrowseFilters';
import { albumYearSubsonicParams } from './albumYearFilter';
import {
  albumListFetchParams,
  albumListFetchType,
  isYearSort,
  sortSubsonicAlbums,
} from './albumBrowseSort';
import type { AlbumBrowsePageResult, AlbumBrowseQuery } from './albumBrowseTypes';
import { GENRE_ALBUM_FETCH_LIMIT } from './albumBrowseTypes';

async function fetchByGenres(genres: string[], serverId?: string | null) {
  const results = await Promise.all(genres.map(g => (
    serverId
      ? getAlbumsByGenreForServer(serverId, g, GENRE_ALBUM_FETCH_LIMIT, 0)
      : getAlbumsByGenre(g, GENRE_ALBUM_FETCH_LIMIT, 0)
  )));
  return dedupeById(results.flat());
}

function applyNetworkPostFilters(albums: SubsonicAlbum[], query: AlbumBrowseQuery) {
  let out = albums;
  if (query.year) out = filterAlbumsByYearBounds(out, query.year);
  out = filterAlbumsByCompilation(out, query.compFilter);
  if (query.starredOnly) out = out.filter(a => !!a.starred);
  return sortSubsonicAlbums(out, query.sort);
}

export async function fetchAlbumBrowseNetwork(
  query: AlbumBrowseQuery,
  offset: number,
  pageSize: number,
  serverId?: string | null,
): Promise<AlbumBrowsePageResult> {
  if (query.genres.length > 0) {
    if (query.genres.length === 1) {
      const data = applyNetworkPostFilters(
        serverId
          ? await getAlbumsByGenreForServer(serverId, query.genres[0], pageSize, offset)
          : await getAlbumsByGenre(query.genres[0], pageSize, offset),
        query,
      );
      return { albums: data, hasMore: data.length === pageSize };
    }
    if (offset > 0) return { albums: [], hasMore: false };
    const data = applyNetworkPostFilters(await fetchByGenres(query.genres, serverId), query);
    return { albums: data, hasMore: false };
  }

  if (query.starredOnly) {
    const extra = query.year ? albumYearSubsonicParams(query.year) : {};
    const data = applyNetworkPostFilters(
      serverId
        ? await getAlbumListForServer(serverId, 'starred', pageSize, offset, extra)
        : await getAlbumList('starred', pageSize, offset, extra),
      query,
    );
    return { albums: data, hasMore: data.length === pageSize };
  }

  if (query.year) {
    // A year sort asks for the range in its own direction so pages stay in year
    // order; any other sort keeps the plain year-filter range.
    const params = isYearSort(query.sort)
      ? albumListFetchParams(query.sort, query.year)
      : albumYearSubsonicParams(query.year);
    const data = applyNetworkPostFilters(
      serverId
        ? await getAlbumListForServer(serverId, 'byYear', pageSize, offset, params)
        : await getAlbumList('byYear', pageSize, offset, params),
      query,
    );
    return { albums: data, hasMore: data.length === pageSize };
  }

  const data = applyNetworkPostFilters(
    serverId
      ? await getAlbumListForServer(
          serverId,
          albumListFetchType(query.sort),
          pageSize,
          offset,
          albumListFetchParams(query.sort),
        )
      : await getAlbumList(
          albumListFetchType(query.sort),
          pageSize,
          offset,
          albumListFetchParams(query.sort),
        ),
    query,
  );
  return { albums: data, hasMore: data.length === pageSize };
}
