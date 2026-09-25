import { describe, expect, it } from 'vitest';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { deriveAlbumVersion } from './albumVersion';

const song = (albumVersion?: string): SubsonicSong => ({
  id: 's', title: 'Song', artist: 'Artist', album: 'Album', albumId: 'a', duration: 1, albumVersion,
});

describe('deriveAlbumVersion', () => {
  it('uses the album version when the title does not carry it', () => {
    expect(deriveAlbumVersion({ name: 'Album', version: 'Deluxe Edition' }, [])).toBe('Deluxe Edition');
  });

  it('hides a version the title already carries', () => {
    expect(deriveAlbumVersion({ name: 'Album (Deluxe Edition)', version: 'Deluxe Edition' }, [])).toBeNull();
    expect(deriveAlbumVersion({ name: 'Album [Live]', version: '[Live]' }, [])).toBeNull();
  });

  it('falls back to the version the tracks agree on', () => {
    expect(deriveAlbumVersion({ name: 'Album' }, [song('Deluxe'), song(), song('Deluxe')])).toBe('Deluxe');
    expect(deriveAlbumVersion({ name: 'Album' }, [song('Deluxe'), song('Standard')])).toBeNull();
    expect(deriveAlbumVersion({ name: 'Album' }, [song()])).toBeNull();
  });
});
