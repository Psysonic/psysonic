import { describe, expect, it } from 'vitest';
import { isOwnPlaylistTouch } from './playlistSelfTouch';

const own = { ownerChanged: false, offlineModeChanged: false, lastModified: 1000, selfTouchedAt: 1000 };

describe('isOwnPlaylistTouch', () => {
  it('skips the reload the page would trigger by touching after its own save', () => {
    expect(isOwnPlaylistTouch(own)).toBe(true);
  });

  it('reloads when another view touched the playlist', () => {
    expect(isOwnPlaylistTouch({ ...own, lastModified: 2000 })).toBe(false);
  });

  it('reloads on a playlist switch or an offline-mode switch', () => {
    expect(isOwnPlaylistTouch({ ...own, ownerChanged: true })).toBe(false);
    expect(isOwnPlaylistTouch({ ...own, offlineModeChanged: true })).toBe(false);
  });

  it('reloads before the page has saved anything', () => {
    expect(isOwnPlaylistTouch({ ...own, selfTouchedAt: undefined })).toBe(false);
    expect(isOwnPlaylistTouch({ ...own, lastModified: undefined, selfTouchedAt: undefined })).toBe(false);
  });
});
