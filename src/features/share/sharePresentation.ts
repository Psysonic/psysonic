import type { SubsonicShare, SubsonicShareEntry } from '@/lib/api/subsonicSharing';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import type { TFunction } from 'i18next';

export function shareEntryLabel(entry: SubsonicShareEntry): string | null {
  for (const key of ['title', 'name', 'album', 'artist']) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null;
}

export function shareEntryIsAlbum(entry: SubsonicShareEntry): boolean {
  return entry.isDir === true
    || entry.type === 'album'
    || entry.mediaType === 'album'
    || (typeof entry.songCount === 'number' && entry.songCount > 0 && !entry.albumId);
}

export function shareResourceCount(share: SubsonicShare): number {
  return (share.entry ?? []).reduce((count, entry) => {
    if (shareEntryIsAlbum(entry) && typeof entry.songCount === 'number') {
      return count + Math.max(0, entry.songCount);
    }
    return count + 1;
  }, 0);
}

export function shareResourceSummary(share: SubsonicShare, t: TFunction): string {
  const count = shareResourceCount(share);
  return count === 0 ? t('shared.noResourceDetails') : t('shared.resources', { count });
}

export function shareEntryAsSong(entry: SubsonicShareEntry): SubsonicSong | null {
  if (shareEntryIsAlbum(entry) || typeof entry.id !== 'string' || typeof entry.title !== 'string') return null;
  return {
    ...entry,
    id: entry.id,
    title: entry.title,
    artist: typeof entry.artist === 'string' ? entry.artist : '',
    album: typeof entry.album === 'string' ? entry.album : '',
    albumId: typeof entry.albumId === 'string' ? entry.albumId : '',
    duration: typeof entry.duration === 'number' ? entry.duration : 0,
  } as SubsonicSong;
}
