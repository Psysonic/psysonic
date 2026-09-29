import { describe, expect, it } from 'vitest';
import {
  classifyPlaylistSmartness,
  hasNavidromeSmartRules,
  isSmartPlaylist,
  playlistDisplayName,
} from '@/lib/format/playlistClassification';

describe('playlist classification', () => {
  it('uses explicit native metadata before the legacy prefix', () => {
    expect(isSmartPlaylist({ name: 'Feishin mix', smart: true })).toBe(true);
    expect(isSmartPlaylist({ name: 'psy-smart-regular', smart: false })).toBe(false);
  });

  it('falls back to the legacy prefix only when native metadata is unknown', () => {
    expect(isSmartPlaylist({ name: 'psy-smart-Legacy mix' })).toBe(true);
    expect(isSmartPlaylist({ name: 'Regular mix' })).toBe(false);
  });

  it('distinguishes failed Navidrome classification from ordinary manual playlists', () => {
    expect(classifyPlaylistSmartness({ name: 'Regular mix' })).toBe('manual');
    expect(classifyPlaylistSmartness({ name: 'Regular mix', smartMetadataUnavailable: true })).toBe('unknown');
    expect(classifyPlaylistSmartness({ name: 'Regular mix', smart: false })).toBe('manual');
    expect(classifyPlaylistSmartness({ name: 'psy-smart-Legacy mix' })).toBe('smart');
  });

  it('treats a playlist the server reports as editable as manual when native metadata failed', () => {
    // Navidrome marks every smart playlist readonly, so an editable one cannot be smart.
    expect(classifyPlaylistSmartness({ name: 'Regular mix', smartMetadataUnavailable: true, readonly: false }))
      .toBe('manual');
    expect(classifyPlaylistSmartness({ name: 'Regular mix', smartMetadataUnavailable: true, readonly: true }))
      .toBe('unknown');
    expect(classifyPlaylistSmartness({ name: 'Regular mix', smart: true, readonly: false })).toBe('smart');
  });

  it('keeps legacy display names unchanged without hiding native names', () => {
    expect(playlistDisplayName({ name: 'psy-smart-Legacy mix' })).toBe('Legacy mix');
    expect(playlistDisplayName({ name: 'Feishin mix' })).toBe('Feishin mix');
  });
});

describe('Navidrome smart rules classification', () => {
  it.each([
    [{ all: [] }, true],
    [{ any: [{ is: { genre: 'Jazz' } }] }, true],
    [{ all: null }, false],
    [{ all: {} }, false],
    [{ limit: 50 }, false],
    [null, false],
  ])('classifies %j as %s', (rules, expected) => {
    expect(hasNavidromeSmartRules(rules)).toBe(expected);
  });
});
