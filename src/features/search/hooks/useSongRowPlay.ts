import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { enqueueAndPlay } from '@/features/playback';
import { useOrbitSongRowBehavior } from '@/features/orbit';

/**
 * What playing one song row does. In an orbit session it collapses into the
 * orbit-suggest / host-enqueue path so we don't ship a queue replacement to every guest.
 */
export function useSongRowPlay(): (song: SubsonicSong) => void {
  const { orbitActive, addTrackToOrbit } = useOrbitSongRowBehavior();
  return (song: SubsonicSong) => {
    if (orbitActive) { addTrackToOrbit(song.id, song.serverId); return; }
    void enqueueAndPlay(song);
  };
}
