import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requiresNativeTransport, type ServerHttpHeaderProfile } from '@/lib/api/subsonicClient';
import {
  clearNativeTransportFallback,
  markNativeTransportRequired,
} from '@/lib/server/nativeTransportFallback';

const PUBLIC = 'https://music.example.com';
const LOCAL = 'http://192.168.0.10:4533';
const PROFILE: ServerHttpHeaderProfile = {
  url: PUBLIC,
  alternateUrl: LOCAL,
  customHeaders: [{ name: 'CF-Access-Client-Token', value: 'gate-token' }],
};

beforeEach(() => clearNativeTransportFallback());
afterEach(() => clearNativeTransportFallback());

describe('requiresNativeTransport — shared probe and REST decision', () => {
  it.each([PUBLIC, LOCAL])('keeps an unpinned address without headers on the WebView: %s', base => {
    expect(requiresNativeTransport(undefined, base)).toBe(false);
    expect(requiresNativeTransport({ url: PUBLIC, alternateUrl: LOCAL }, base)).toBe(false);
  });

  it.each([
    { scope: undefined, publicNative: true, localNative: false },
    { scope: 'public', publicNative: true, localNative: false },
    { scope: 'local', publicNative: false, localNative: true },
    { scope: 'both', publicNative: true, localNative: true },
  ] as const)('honours header scope $scope on both addresses', ({ scope, publicNative, localNative }) => {
    const profile = { ...PROFILE, customHeadersApplyTo: scope };
    expect(requiresNativeTransport(profile, PUBLIC)).toBe(publicNative);
    expect(requiresNativeTransport(profile, LOCAL)).toBe(localNative);
  });

  it.each([
    { scope: 'public', publicNative: true, localNative: false },
    { scope: 'local', publicNative: false, localNative: true },
    { scope: 'both', publicNative: true, localNative: true },
  ] as const)('normalizes trailing slashes for scope $scope', ({ scope, publicNative, localNative }) => {
    const profile = {
      ...PROFILE,
      url: `${PUBLIC}/`,
      alternateUrl: `${LOCAL}/`,
      customHeadersApplyTo: scope,
    };
    expect(requiresNativeTransport(profile, `${PUBLIC}/`)).toBe(publicNative);
    expect(requiresNativeTransport(profile, `${LOCAL}/`)).toBe(localNative);
  });

  it.each([PUBLIC, LOCAL])('uses a normalized pin without a header profile only for %s', base => {
    markNativeTransportRequired(`${base}/`);

    expect(requiresNativeTransport(undefined, base)).toBe(true);
    expect(requiresNativeTransport(undefined, `${base}/`)).toBe(true);
    const other = base === PUBLIC ? LOCAL : PUBLIC;
    expect(requiresNativeTransport(undefined, other)).toBe(false);
    expect(requiresNativeTransport(undefined, `${base}/other`)).toBe(false);
  });
});
