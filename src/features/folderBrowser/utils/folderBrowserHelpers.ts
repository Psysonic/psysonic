import type React from 'react';
import type { SubsonicAlbum, SubsonicDirectoryEntry, SubsonicOpenArtistRef } from '@/lib/api/subsonicTypes';
import type { Track } from '@/lib/media/trackTypes';
import type { LibraryAlbumDto, LibraryArtistDto, LibraryTrackDto } from '@/lib/api/library/dto';
import { coerceOpenArtistRefs } from '@/lib/api/openArtistRefs';

export type ColumnKind = 'roots' | 'artists' | 'albums' | 'tracks';
export type NavPos = { colIndex: number; rowIndex: number };

export type Column = {
  id: string;
  name: string;
  items: SubsonicDirectoryEntry[];
  selectedKey: string | null;
  loading: boolean;
  error: boolean;
  kind: ColumnKind;
  serverId?: string;
  scopes?: { serverId: string; libraryId: string }[];
};

/** Server APIs only guarantee entity IDs are unique within one server. */
export function folderBrowserEntryKey(entry: Pick<SubsonicDirectoryEntry, 'id' | 'serverId'>): string {
  return `${entry.serverId ?? ''}\u0000${entry.id}`;
}

export function selectedFolderBrowserEntry(column: Column): SubsonicDirectoryEntry | undefined {
  return column.selectedKey
    ? column.items.find(item => folderBrowserEntryKey(item) === column.selectedKey)
    : undefined;
}

export function artistDtoToFolderEntry(artist: LibraryArtistDto): SubsonicDirectoryEntry {
  return {
    id: artist.id,
    serverId: artist.serverId,
    title: artist.name,
    artistId: artist.id,
    isDir: true,
  };
}

export function albumDtoToFolderEntry(album: LibraryAlbumDto): SubsonicDirectoryEntry {
  return {
    id: album.id,
    serverId: album.serverId,
    title: album.name,
    artist: album.artist ?? undefined,
    artistId: album.artistId ?? undefined,
    album: album.name,
    albumId: album.id,
    coverArt: album.coverArtId ?? undefined,
    year: album.year ?? undefined,
    genre: album.genre ?? undefined,
    isDir: true,
  };
}

export function trackDtoToFolderEntry(track: LibraryTrackDto): SubsonicDirectoryEntry {
  const rawArtists = track.rawJson && typeof track.rawJson === 'object' && !Array.isArray(track.rawJson)
    ? coerceOpenArtistRefs(
        (track.rawJson as { artists?: SubsonicOpenArtistRef[] | SubsonicOpenArtistRef | null }).artists,
      )
    : [];
  return {
    id: track.id,
    serverId: track.serverId,
    title: track.title,
    artist: track.artist ?? undefined,
    artistId: track.artistId ?? undefined,
    ...(rawArtists.length > 0 ? { artists: rawArtists } : {}),
    album: track.album,
    albumId: track.albumId ?? undefined,
    coverArt: track.coverArtId ?? undefined,
    duration: track.durationSec,
    track: track.trackNumber ?? undefined,
    year: track.year ?? undefined,
    bitRate: track.bitRate ?? undefined,
    suffix: track.suffix ?? undefined,
    genre: track.genre ?? undefined,
    starred: track.starredAt != null ? new Date(track.starredAt).toISOString() : undefined,
    userRating: track.userRating ?? undefined,
    isDir: false,
  };
}

/** getMusicDirectory: `albumId` or `album` + row `id` (Navidrome). */
export function entryToAlbumIfPresent(item: SubsonicDirectoryEntry): SubsonicAlbum | null {
  if (!item.isDir) return null;
  const albumId = item.albumId ?? (item.album ? item.id : undefined);
  if (!albumId) return null;
  return {
    id: albumId,
    serverId: item.serverId,
    name: item.album ?? item.title,
    artist: item.artist ?? '',
    artistId: item.artistId ?? '',
    coverArt: item.coverArt,
    year: item.year,
    genre: item.genre,
    starred: item.starred,
    userRating: item.userRating,
    songCount: 0,
    duration: 0,
  };
}

export function entryToTrack(e: SubsonicDirectoryEntry): Track {
  const artists = coerceOpenArtistRefs(e.artists);
  return {
    id: e.id,
    serverId: e.serverId,
    title: e.title,
    artist: e.artist ?? '',
    album: e.album ?? '',
    albumId: e.albumId ?? '',
    artistId: e.artistId,
    ...(artists.length > 0 ? { artists } : {}),
    coverArt: e.coverArt,
    duration: e.duration ?? 0,
    track: e.track,
    year: e.year,
    bitRate: e.bitRate,
    suffix: e.suffix,
    genre: e.genre,
    starred: e.starred,
    userRating: e.userRating,
  };
}

export function isFolderBrowserArrowKey(e: React.KeyboardEvent): boolean {
  return (
    e.key === 'ArrowUp' ||
    e.key === 'ArrowDown' ||
    e.key === 'ArrowLeft' ||
    e.key === 'ArrowRight' ||
    e.code === 'ArrowUp' ||
    e.code === 'ArrowDown' ||
    e.code === 'ArrowLeft' ||
    e.code === 'ArrowRight'
  );
}

/** Modifiers from native event + getModifierState (WebKit/WebView can miss flags on the synthetic event). */
export function folderBrowserHasKeyModifiers(e: React.KeyboardEvent): boolean {
  const n = e.nativeEvent;
  if (n.ctrlKey || n.altKey || n.shiftKey || n.metaKey) return true;
  if (typeof n.getModifierState === 'function') {
    return (
      n.getModifierState('Control') ||
      n.getModifierState('Alt') ||
      n.getModifierState('Shift') ||
      n.getModifierState('Meta') ||
      n.getModifierState('OS')
    );
  }
  return false;
}
