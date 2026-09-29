import { describe, expect, it } from 'vitest';
import { playlistDetailControls, playlistTracksAreReadOnly } from './playlistSmartUx';

describe('playlist smart UX policy', () => {
  it('treats native and legacy-prefix smart playlists as read-only track sources', () => {
    expect(playlistTracksAreReadOnly({ name: 'Feishin mix', smart: true })).toBe(true);
    expect(playlistTracksAreReadOnly({ name: 'psy-smart-Legacy' })).toBe(true);
    expect(playlistTracksAreReadOnly({ name: 'psy-smart-Regular', smart: false })).toBe(false);
    expect(playlistTracksAreReadOnly({ name: 'Manual mix' })).toBe(false);
  });

  it('hides membership mutations while keeping metadata and cache-removal eligible', () => {
    expect(playlistDetailControls({ name: 'Native', smart: true })).toEqual({
      tracksReadOnly: true,
      showEditRules: true,
      showRefreshTracks: true,
      canAddTracks: false,
      canImportCsv: false,
      canReorderTracks: false,
      canRemoveTracks: false,
      canPinNewOfflineCache: false,
    });
    expect(playlistDetailControls({ name: 'Manual mix', smart: false }).canAddTracks).toBe(true);
    expect(playlistDetailControls({ name: 'Manual mix', smart: false }).showRefreshTracks).toBe(false);
  });

  it('fails closed for unknown classification without exposing smart-only actions', () => {
    expect(playlistDetailControls({
      name: 'Unclassified mix',
      smartMetadataUnavailable: true,
    })).toEqual({
      tracksReadOnly: true,
      showEditRules: false,
      showRefreshTracks: false,
      canAddTracks: false,
      canImportCsv: false,
      canReorderTracks: false,
      canRemoveTracks: false,
      canPinNewOfflineCache: false,
    });
  });

  it('allows reordering and removing when the server reports the playlist as editable', () => {
    const controls = playlistDetailControls({
      name: 'Own mix',
      smartMetadataUnavailable: true,
      readonly: false,
    });
    expect(controls.canReorderTracks).toBe(true);
    expect(controls.canRemoveTracks).toBe(true);
    expect(controls.canAddTracks).toBe(true);
    expect(controls.showEditRules).toBe(false);
  });
});
