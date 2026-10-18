import { formatTrackTime } from '@/lib/format/formatDuration';

export interface TrackNotificationContent {
  title: string;
  body: string;
}

function joinLines(lines: readonly (string | null | undefined)[]): string {
  return lines.map(line => line?.trim()).filter(Boolean).join('\n');
}

/** Song title on top, then artist, then `Album · 4:41`. */
export function trackNotificationContent(track: {
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
}): TrackNotificationContent {
  const albumLine = [track.album?.trim(), formatTrackTime(track.duration ?? 0, '')]
    .filter(Boolean)
    .join(' · ');
  return { title: track.title, body: joinLines([track.artist, albumLine]) };
}

/** Stream title on top, then the artist the stream reports, then the station. */
export function radioNotificationContent(radio: {
  title: string;
  artist?: string;
  stationName: string;
}): TrackNotificationContent {
  const artist = radio.artist?.trim() === radio.stationName.trim() ? undefined : radio.artist;
  return { title: radio.title, body: joinLines([artist, radio.stationName]) };
}
