import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { formatHumanHoursMinutes } from '@/lib/format/formatHumanDuration';
import { formatMb } from '@/lib/format/formatBytes';
import { genreTagsFor } from '@/lib/library/genreTags';

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .substring(0, 200) || 'download';
}

export function formatSize(bytes?: number): string {
  return bytes ? formatMb(bytes) : '';
}

export function totalDurationLabel(songs: SubsonicSong[]): string {
  const total = songs.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  return formatHumanHoursMinutes(total);
}

/**
 * Every genre a track carries, in one cell. The single-value `genre` column
 * shows what the server calls the main one; this one shows the whole set, which
 * is what the file is actually tagged with.
 */
export function genresLabel(song: SubsonicSong): string {
  return genreTagsFor(song).join(' · ');
}

/**
 * Mood tags the file carries (MOOD / TMOO), as one label. Separate from the
 * moods the analysis derives — those are ids the app translates, these are the
 * words the tagger wrote and are shown as they are.
 */
export function moodsLabel(song: SubsonicSong): string {
  const moods = Array.isArray(song.moods) ? song.moods : [];
  const names: string[] = [];
  for (const mood of moods) {
    const name = typeof mood === 'string' ? mood.trim() : '';
    if (name && !names.some(n => n.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names.join(' · ');
}

export function codecLabel(song: SubsonicSong, showBitrate: boolean): string {
  const parts: string[] = [];
  if (song.suffix) parts.push(song.suffix.toUpperCase());
  if (showBitrate && song.bitRate) parts.push(`${song.bitRate} kbps`);
  return parts.join(' · ');
}
