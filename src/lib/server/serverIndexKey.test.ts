import { beforeEach, describe, expect, it, vi } from 'vitest';

const servers = vi.hoisted(() => [] as Array<{ id: string; url: string }>);

vi.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ servers }),
  },
}));

import { resolveStorageServerIndexKey } from '@/lib/server/serverIndexKey';

const PROFILE_ID = '7d9f7c36-1c55-4a6f-ae24-87ab823f5b61';

beforeEach(() => {
  servers.splice(0, servers.length);
});

describe('resolveStorageServerIndexKey', () => {
  it('resolves a known profile UUID through its primary URL', () => {
    servers.push({ id: PROFILE_ID, url: 'https://music.example.test/subsonic/' });
    expect(resolveStorageServerIndexKey(PROFILE_ID)).toBe('music.example.test/subsonic');
  });

  it('rejects an unknown profile UUID instead of using it as a storage key', () => {
    expect(resolveStorageServerIndexKey('9ee02895-4d12-4faa-9a9f-3fae22b64d18')).toBeNull();
  });

  it('keeps the index key of a configured server with a timestamp-shaped hostname', () => {
    // `mpserver` decodes to May 2026, inside the plausible minting window.
    servers.push({ id: PROFILE_ID, url: 'http://mpserver' });
    expect(resolveStorageServerIndexKey('mpserver')).toBe('mpserver');
  });

  it('keeps unconfigured bare hostnames whatever their base36 shape', () => {
    // Both decode into the profile-id minting window, so no prefix rule can
    // separate them from an ephemeral id. This resolver keeps them; refusing
    // ephemeral identity is the analysis boundary's job, using the store's
    // record of minted ids rather than a guess at the shape.
    expect(resolveStorageServerIndexKey('mpserver')).toBe('mpserver');
    expect(resolveStorageServerIndexKey('mpserver01')).toBe('mpserver01');
    expect(resolveStorageServerIndexKey('http://mpserver')).toBe('mpserver');
  });

  it('keeps keys that are not shaped like a generated profile id', () => {
    expect(resolveStorageServerIndexKey('server-a')).toBe('server-a');
    expect(resolveStorageServerIndexKey('s1')).toBe('s1');
    expect(resolveStorageServerIndexKey('localhost')).toBe('localhost');
    expect(resolveStorageServerIndexKey('navidrome:4533')).toBe('navidrome:4533');
    expect(resolveStorageServerIndexKey('192.0.2.10:4533')).toBe('192.0.2.10:4533');
  });

  it('normalizes a primary URL into the existing address-derived key', () => {
    expect(resolveStorageServerIndexKey('https://music.example.test/subsonic/'))
      .toBe('music.example.test/subsonic');
  });

  it('keeps an existing URL-derived index key stable', () => {
    expect(resolveStorageServerIndexKey('music.example.test/subsonic'))
      .toBe('music.example.test/subsonic');
  });

  it('rejects empty input', () => {
    expect(resolveStorageServerIndexKey('   ')).toBeNull();
  });
});
