import { useEffect, useState } from 'react';
import { libraryGetTracksBatchChunked } from '@/lib/api/library';
import type { PlaySessionDayTrack } from '@/lib/api/library';
import { isExplicit } from '@/lib/media/explicitStatus';
import { useThemeStore } from '@/store/themeStore';

const EMPTY: ReadonlySet<string> = new Set();

export function dayTrackKey(track: Pick<PlaySessionDayTrack, 'serverId' | 'trackId'>): string {
  return `${track.serverId}:${track.trackId}`;
}

/**
 * Listening history keeps only the title and artist of each play, so whether a
 * track is explicit comes from the local index — read once per opened day, and
 * only while the badges are switched on.
 */
export function useExplicitDayTrackKeys(tracks: readonly PlaySessionDayTrack[]): ReadonlySet<string> {
  const enabled = useThemeStore(s => s.showExplicitBadges);
  const [result, setResult] = useState<{ tracks: readonly PlaySessionDayTrack[]; keys: ReadonlySet<string> } | null>(null);

  useEffect(() => {
    if (!enabled || tracks.length === 0) return;
    let cancelled = false;
    const refs = [...new Map(tracks.map(t => [dayTrackKey(t), { serverId: t.serverId, trackId: t.trackId }])).values()];
    void libraryGetTracksBatchChunked(refs).then(dtos => {
      if (cancelled) return;
      const keys = new Set<string>();
      for (const dto of dtos) {
        const raw = dto.rawJson;
        if (raw && typeof raw === 'object' && isExplicit(raw as { explicitStatus?: string })) {
          keys.add(dayTrackKey({ serverId: dto.serverId, trackId: dto.id }));
        }
      }
      setResult({ tracks, keys });
    });
    return () => { cancelled = true; };
  }, [enabled, tracks]);

  return enabled && result?.tracks === tracks ? result.keys : EMPTY;
}
