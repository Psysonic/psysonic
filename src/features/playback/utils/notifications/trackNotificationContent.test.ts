import { describe, expect, it } from 'vitest';
import { radioNotificationContent, trackNotificationContent } from './trackNotificationContent';

describe('trackNotificationContent', () => {
  it('puts the title on top, then the artist, then album and duration', () => {
    expect(trackNotificationContent({
      title: 'Opening',
      artist: 'Artist',
      album: 'Album',
      duration: 281,
    })).toEqual({ title: 'Opening', body: 'Artist\nAlbum · 4:41' });
  });

  it('leaves out what the track does not carry', () => {
    expect(trackNotificationContent({ title: 'Opening', artist: 'Artist' }))
      .toEqual({ title: 'Opening', body: 'Artist' });
    expect(trackNotificationContent({ title: 'Opening', duration: 61 }))
      .toEqual({ title: 'Opening', body: '1:01' });
  });
});

describe('radioNotificationContent', () => {
  it('puts the stream title on top, then the artist, then the station', () => {
    expect(radioNotificationContent({ title: 'Song', artist: 'Band', stationName: 'Station' }))
      .toEqual({ title: 'Song', body: 'Band\nStation' });
  });

  it('does not repeat the station when it stands in for the artist', () => {
    expect(radioNotificationContent({ title: 'Song', artist: 'Station', stationName: 'Station' }))
      .toEqual({ title: 'Song', body: 'Station' });
  });
});
