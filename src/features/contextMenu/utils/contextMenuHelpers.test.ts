import { describe, expect, it } from 'vitest';
import { manualPlaylistTargetsForServer, splitPlaylistTargets } from '@/features/contextMenu/utils/contextMenuHelpers';
import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

describe('manualPlaylistTargetsForServer', () => {
  it('keeps only manual playlists owned by the requested server', () => {
    const playlists = [
      { id: 'shared', name: 'A', smart: false, songCount: 0, duration: 0, created: '', changed: '', serverId: 'server-a' },
      { id: 'shared', name: 'B', smart: false, songCount: 0, duration: 0, created: '', changed: '', serverId: 'server-b' },
      { id: 'smart', name: 'psy-smart-auto', songCount: 0, duration: 0, created: '', changed: '', serverId: 'server-a' },
      { id: 'native-smart', name: 'Feishin mix', smart: true, songCount: 0, duration: 0, created: '', changed: '', serverId: 'server-a' },
      { id: 'prefix-false-positive', name: 'psy-smart-Regular', smart: false, songCount: 0, duration: 0, created: '', changed: '', serverId: 'server-a' },
      { id: 'unknown', name: 'Unclassified', smartMetadataUnavailable: true, songCount: 0, duration: 0, created: '', changed: '', serverId: 'server-a' },
      { id: 'ordinary', name: 'Ordinary', songCount: 0, duration: 0, created: '', changed: '', serverId: 'server-a' },
      { id: 'legacy', name: 'Legacy', songCount: 0, duration: 0, created: '', changed: '' },
    ];

    expect(manualPlaylistTargetsForServer(playlists, 'server-a').map(p => p.name))
      .toEqual(['A', 'psy-smart-Regular', 'Ordinary']);
    expect(manualPlaylistTargetsForServer(playlists, 'server-b').map(p => p.name))
      .toEqual(['B']);
    expect(manualPlaylistTargetsForServer(playlists, undefined)).toEqual([]);
  });

  it('offers playlists the server reports as editable when native metadata failed', () => {
    const unavailable = { smartMetadataUnavailable: true, songCount: 0, duration: 0, created: '', changed: '', serverId: 'server-a' };
    const playlists = [
      { id: 'own', name: 'Own', readonly: false, ...unavailable },
      { id: 'foreign-or-smart', name: 'Locked', readonly: true, ...unavailable },
      { id: 'plain-subsonic', name: 'No flag', ...unavailable },
    ];

    expect(manualPlaylistTargetsForServer(playlists, 'server-a').map(p => p.name)).toEqual(['Own']);
  });
});

describe('splitPlaylistTargets', () => {
  const playlist = (name: string, serverId = 'srv'): SubsonicPlaylist => ({
    id: name.toLowerCase(), name, songCount: 0, duration: 0, created: '', changed: '', serverId,
  });
  const key = (name: string, serverId = 'srv') => ownedEntityKey({ id: name.toLowerCase(), serverId });
  const many = ['Gamma', 'Alpha', 'Delta', 'Beta', 'Zeta', 'Epsilon'].map(name => playlist(name));

  it('lists every target alphabetically and the three newest recent ones on top', () => {
    const { recent, all } = splitPlaylistTargets(many, [key('Zeta'), key('Beta'), key('Gamma'), key('Alpha')], 'srv');
    expect(all.map(p => p.name)).toEqual(['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma', 'Zeta']);
    expect(recent.map(p => p.name)).toEqual(['Zeta', 'Beta', 'Gamma']);
  });

  it('skips recent ids that are not targets here', () => {
    const { recent } = splitPlaylistTargets(many, [key('Gone'), key('Beta', 'other-server'), key('Delta')], 'srv');
    expect(recent.map(p => p.name)).toEqual(['Delta']);
  });

  it('shows no recent section for a short list', () => {
    const few = many.slice(0, 5);
    expect(splitPlaylistTargets(few, [key('Gamma')], 'srv').recent).toEqual([]);
  });
});
