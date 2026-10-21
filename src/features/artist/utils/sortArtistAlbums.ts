import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';

export type ArtistAlbumOrder = 'yearDesc' | 'yearAsc' | 'nameAsc' | 'nameDesc';

const compareName = (a: SubsonicAlbum, b: SubsonicAlbum) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/** Albums of one release type in the chosen order. Ties on the year fall back to the
 *  name, ties on the name to the newer album first. */
export function sortArtistAlbums(
  albums: SubsonicAlbum[],
  order: ArtistAlbumOrder,
): SubsonicAlbum[] {
  const out = [...albums];
  out.sort((a, b) => {
    const ay = a.year ?? 0;
    const by = b.year ?? 0;
    if (order === 'nameAsc' || order === 'nameDesc') {
      const byName = compareName(a, b);
      if (byName !== 0) return order === 'nameAsc' ? byName : -byName;
      return by - ay;
    }
    if (ay !== by) return order === 'yearDesc' ? by - ay : ay - by;
    return compareName(a, b);
  });
  return out;
}
