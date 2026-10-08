import { describe, expect, it } from 'vitest';
import { playlistPathId, trackToSyncInfo, withPlaylistPathIds } from './deviceSyncHelpers';

const playlist = (id: string, name: string) => ({ type: 'playlist', id, name });

describe('playlistPathId', () => {
  it('preserves the legacy folder for a unique playlist name', () => {
    const source = playlist('one', 'Road Trip');
    expect(playlistPathId(source, [source])).toBeUndefined();
  });

  it('disambiguates identical and sanitization-equivalent names', () => {
    const sources = [
      playlist('one', 'Road/Trip'),
      playlist('two', 'Road:Trip'),
    ];
    expect(playlistPathId(sources[0], sources)).toBe('one');
    expect(playlistPathId(sources[1], sources)).toBe('two');
  });

  it('passes the discriminator into track sync data', () => {
    const info = trackToSyncInfo(
      {
        id: 'track',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        albumId: 'album',
        duration: 180,
      },
      '',
      { id: 'playlist', name: 'Mix', index: 1 },
    );
    expect(info.playlistId).toBe('playlist');
  });

  it('carries the flat-layout mark from a planned track, or takes it explicitly', () => {
    const song = {
      id: 'track', title: 'Song', artist: 'Artist', album: 'Album', albumId: 'album', duration: 180,
    };
    expect(trackToSyncInfo({ ...song, _flatLayout: true }, '').flatLayout).toBe(true);
    expect(trackToSyncInfo(song, '').flatLayout).toBe(false);
    expect(trackToSyncInfo(song, '', undefined, true).flatLayout).toBe(true);
  });

  it('keeps a collision discriminator after the other playlist is removed', () => {
    const sources = withPlaylistPathIds([
      playlist('one', 'Road/Trip'),
      playlist('two', 'Road:Trip'),
    ]);
    expect(playlistPathId(sources[0], [sources[0]])).toBe('one');
  });
});

describe('trackToSyncInfo album artist', () => {
  const song = {
    id: 'track', title: 'Song', artist: 'Main Artist feat. Guest', album: 'Album', albumId: 'album', duration: 180,
  };

  it('files a Navidrome song under its displayAlbumArtist, not the track artist', () => {
    const info = trackToSyncInfo({ ...song, displayAlbumArtist: 'Main Artist' }, '');
    expect(info.albumArtist).toBe('Main Artist');
    expect(info.artist).toBe('Main Artist feat. Guest');
  });

  it('keeps albumArtist ahead of displayAlbumArtist', () => {
    const info = trackToSyncInfo(
      { ...song, albumArtist: 'Tagged Album Artist', displayAlbumArtist: 'Display Album Artist' },
      '',
    );
    expect(info.albumArtist).toBe('Tagged Album Artist');
  });

  it('falls back to the track artist when no album artist field is set', () => {
    expect(trackToSyncInfo({ ...song, displayAlbumArtist: '  ' }, '').albumArtist)
      .toBe('Main Artist feat. Guest');
  });
});
