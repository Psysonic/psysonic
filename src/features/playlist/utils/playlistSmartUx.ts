import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import { classifyPlaylistSmartness } from '@/lib/format/playlistClassification';

type ClassifiablePlaylist = Pick<SubsonicPlaylist, 'name'>
  & Pick<Partial<SubsonicPlaylist>, 'smart' | 'smartMetadataUnavailable'>;

/** Smart playlist tracks are server-evaluated — clients must not mutate membership. */
export function playlistTracksAreReadOnly(playlist: ClassifiablePlaylist): boolean {
  return classifyPlaylistSmartness(playlist) !== 'manual';
}

export function playlistDetailControls(playlist: ClassifiablePlaylist) {
  const classification = classifyPlaylistSmartness(playlist);
  const tracksReadOnly = playlistTracksAreReadOnly(playlist);
  return {
    tracksReadOnly,
    showEditRules: classification === 'smart',
    showRefreshTracks: classification === 'smart',
    canAddTracks: !tracksReadOnly,
    canImportCsv: !tracksReadOnly,
    canReorderTracks: !tracksReadOnly,
    canRemoveTracks: !tracksReadOnly,
    canPinNewOfflineCache: !tracksReadOnly,
  };
}
