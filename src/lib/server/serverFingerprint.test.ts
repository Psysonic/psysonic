import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the apiWithCredentials surface — fetchServerFingerprint pulls
// folders / user / license / indexes through it.
vi.mock('@/lib/api/subsonicClient', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/api/subsonicClient')>();
  return {
    ...original,
    apiWithCredentials: vi.fn(),
  };
});

// The native connect probe stands in for the WebView ping on gated servers.
vi.mock('@/lib/api/subsonic', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/api/subsonic')>();
  return {
    ...original,
    pingWithCredentialsForProfile: vi.fn(),
  };
});

import { apiWithCredentials } from '@/lib/api/subsonicClient';
import { pingWithCredentialsForProfile } from '@/lib/api/subsonic';
import {
  compareFingerprints,
  fetchServerFingerprint,
  verifySameServerEndpoints,
  type ServerFingerprint,
} from '@/lib/server/serverFingerprint';

function makeFingerprint(overrides: Partial<ServerFingerprint> = {}): ServerFingerprint {
  return {
    ping: {
      ok: true,
      type: 'navidrome',
      serverVersion: '0.55.0',
      openSubsonic: true,
      apiVersion: '1.16.1',
    },
    musicFolders: [{ id: '1', name: 'Music' }],
    userId: 'tester',
    licenseKey: 'tester@example.com',
    indexesDigest: 'letters:26|a1,a2',
    ...overrides,
  };
}

/** Ping result the native probe reports for a Navidrome-shaped server. */
function navidromeProbe() {
  return {
    ok: true,
    type: 'navidrome',
    serverVersion: '0.55.0',
    apiVersion: '1.16.1',
    openSubsonic: true,
  };
}

/** Minimal Subsonic shape — ampache does not always advertise openSubsonic. */
function ampacheProbe() {
  return {
    ok: true,
    type: 'ampache',
    serverVersion: '6.0.0',
    apiVersion: '1.13.0',
    openSubsonic: false,
  };
}

describe('compareFingerprints', () => {
  it('matches two identical fingerprints', () => {
    const a = makeFingerprint();
    const b = makeFingerprint();
    expect(compareFingerprints(a, b)).toBe('match');
  });

  it('mismatches when type differs (case-insensitive)', () => {
    const a = makeFingerprint({ ping: { ...makeFingerprint().ping, type: 'navidrome' } });
    const b = makeFingerprint({ ping: { ...makeFingerprint().ping, type: 'subsonic' } });
    expect(compareFingerprints(a, b)).toBe('mismatch');
  });

  it('mismatches when serverVersion differs', () => {
    const a = makeFingerprint({ ping: { ...makeFingerprint().ping, serverVersion: '0.55.0' } });
    const b = makeFingerprint({ ping: { ...makeFingerprint().ping, serverVersion: '0.54.9' } });
    expect(compareFingerprints(a, b)).toBe('mismatch');
  });

  it('mismatches when openSubsonic differs', () => {
    const a = makeFingerprint({ ping: { ...makeFingerprint().ping, openSubsonic: true } });
    const b = makeFingerprint({ ping: { ...makeFingerprint().ping, openSubsonic: false } });
    expect(compareFingerprints(a, b)).toBe('mismatch');
  });

  it('treats envelope apiVersion as informational (no mismatch on its own)', () => {
    const a = makeFingerprint({ ping: { ...makeFingerprint().ping, apiVersion: '1.16.1' } });
    const b = makeFingerprint({ ping: { ...makeFingerprint().ping, apiVersion: '1.13.0' } });
    expect(compareFingerprints(a, b)).toBe('match');
  });

  it('mismatches when musicFolders differ', () => {
    const a = makeFingerprint({ musicFolders: [{ id: '1', name: 'Music' }] });
    const b = makeFingerprint({ musicFolders: [{ id: '1', name: 'Music' }, { id: '2', name: 'Audiobooks' }] });
    expect(compareFingerprints(a, b)).toBe('mismatch');
  });

  it('treats empty musicFolders on both sides as a matching signal', () => {
    const a = makeFingerprint({ musicFolders: [], userId: null, licenseKey: null, indexesDigest: null });
    const b = makeFingerprint({ musicFolders: [], userId: null, licenseKey: null, indexesDigest: null });
    expect(compareFingerprints(a, b)).toBe('match');
  });

  it('mismatches when userId differs', () => {
    const a = makeFingerprint({ userId: 'tester' });
    const b = makeFingerprint({ userId: 'maria' });
    expect(compareFingerprints(a, b)).toBe('mismatch');
  });

  it('mismatches when licenseKey differs', () => {
    const a = makeFingerprint({ licenseKey: 'a@example.com' });
    const b = makeFingerprint({ licenseKey: 'b@example.com' });
    expect(compareFingerprints(a, b)).toBe('mismatch');
  });

  it('mismatches when indexesDigest differs', () => {
    const a = makeFingerprint({ indexesDigest: 'letters:5|x,y' });
    const b = makeFingerprint({ indexesDigest: 'letters:5|x,z' });
    expect(compareFingerprints(a, b)).toBe('mismatch');
  });

  it('ignores a body signal that is null on one side', () => {
    // userId null on a — only license + folders + indexes contribute; they match.
    const a = makeFingerprint({ userId: null });
    const b = makeFingerprint({ userId: 'tester' });
    expect(compareFingerprints(a, b)).toBe('match');
  });

  it('returns insufficient when ping matches but every body signal is null on at least one side', () => {
    const a = makeFingerprint({
      musicFolders: null,
      userId: null,
      licenseKey: null,
      indexesDigest: null,
    });
    const b = makeFingerprint();
    expect(compareFingerprints(a, b)).toBe('insufficient');
  });
});

describe('fetchServerFingerprint', () => {
  beforeEach(() => {
    vi.mocked(apiWithCredentials).mockReset();
    vi.mocked(pingWithCredentialsForProfile).mockReset();
    // The fingerprint must never touch the WebView fetch path: a gated address
    // rejects its preflight and a CORS-less address hides the response.
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns a populated fingerprint for a Navidrome-shaped server', async () => {
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue(navidromeProbe());
    vi.mocked(apiWithCredentials)
      .mockResolvedValueOnce({ musicFolders: { musicFolder: [{ id: '1', name: 'Music' }] } })
      .mockResolvedValueOnce({ user: { id: 'tester', username: 'tester' } })
      .mockResolvedValueOnce({ license: { email: 'tester@example.com' } })
      .mockResolvedValueOnce({
        indexes: {
          index: [
            { name: 'A', artist: [{ id: 'a1' }, { id: 'a2' }] },
            { name: 'B', artist: [{ id: 'b1' }] },
          ],
        },
      });

    const fp = await fetchServerFingerprint('https://music.example.com', 'tester', 'pw');
    expect(fp.ping.type).toBe('navidrome');
    expect(fp.ping.serverVersion).toBe('0.55.0');
    expect(fp.ping.openSubsonic).toBe(true);
    // Carried from the Subsonic envelope `version` through the probe.
    expect(fp.ping.apiVersion).toBe('1.16.1');
    expect(fp.musicFolders).toEqual([{ id: '1', name: 'Music' }]);
    expect(fp.userId).toBe('tester');
    expect(fp.licenseKey).toBe('tester@example.com');
    expect(fp.indexesDigest).toMatch(/^letters:2\|/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the profile credentials and gate headers with the ping', async () => {
    // The gate header has to ride the ping itself, or a gated address answers
    // 401 and verify calls it unreachable.
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue(navidromeProbe());
    vi.mocked(apiWithCredentials).mockRejectedValue(new Error('not needed'));

    await fetchServerFingerprint(
      'https://music.example.com',
      'tester',
      'pw',
      {
        url: 'https://music.example.com',
        alternateUrl: 'http://192.168.0.10:4533',
        customHeaders: [{ name: 'Authorization', value: 'Basic dXNlcjpwYXNz' }],
        customHeadersApplyTo: 'public',
      },
    );

    expect(vi.mocked(pingWithCredentialsForProfile).mock.calls[0]![0]).toMatchObject({
      username: 'tester',
      password: 'pw',
      customHeaders: [{ name: 'Authorization', value: 'Basic dXNlcjpwYXNz' }],
      customHeadersApplyTo: 'public',
    });
  });

  it('extracts userId only when the server supplies an explicit id (no username fallback)', async () => {
    // Two servers return the same authenticated user but only one of them
    // surfaces a `user.id` — the username-only side must extract null so the
    // comparator skips the signal instead of comparing two unrelated strings.
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue(navidromeProbe());
    vi.mocked(apiWithCredentials)
      .mockResolvedValueOnce({ musicFolders: { musicFolder: [] } })
      .mockResolvedValueOnce({ user: { username: 'tester' } }) // no `id` field
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const fp = await fetchServerFingerprint('https://x.example.com', 'tester', 'pw');
    expect(fp.userId).toBeNull();
  });

  it('handles a partial-fail mix — some optional calls ok, others rejected', async () => {
    // Real-world: a server answers getMusicFolders + getUser but rejects
    // getLicense / getIndexes (subset of OpenSubsonic supported). The
    // fingerprint must surface what succeeded and leave the rest null —
    // guards against a Promise.all-vs-allSettled regression that would
    // collapse the whole fingerprint when one call throws.
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue(navidromeProbe());
    vi.mocked(apiWithCredentials)
      .mockResolvedValueOnce({ musicFolders: { musicFolder: [{ id: '1', name: 'Music' }] } })
      .mockResolvedValueOnce({ user: { id: 'tester' } })
      .mockRejectedValueOnce(new Error('license not implemented'))
      .mockRejectedValueOnce(new Error('indexes not implemented'));
    const fp = await fetchServerFingerprint('https://music.example.com', 'tester', 'pw');
    expect(fp.musicFolders).toEqual([{ id: '1', name: 'Music' }]);
    expect(fp.userId).toBe('tester');
    expect(fp.licenseKey).toBeNull();
    expect(fp.indexesDigest).toBeNull();
  });

  it('soft-fails optional calls — minimal Subsonic-shape', async () => {
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue(ampacheProbe());
    // All four optional calls fail (server doesn't support them).
    vi.mocked(apiWithCredentials).mockRejectedValue(new Error('Not implemented'));

    const fp = await fetchServerFingerprint('https://ampache.example.com', 'u', 'p');
    expect(fp.ping.type).toBe('ampache');
    expect(fp.ping.serverVersion).toBe('6.0.0');
    expect(fp.ping.openSubsonic).toBe(false);
    expect(fp.musicFolders).toBeNull();
    expect(fp.userId).toBeNull();
    expect(fp.licenseKey).toBeNull();
    expect(fp.indexesDigest).toBeNull();
  });

  it('returns a null-bodied fingerprint when ping itself fails', async () => {
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue({ ok: false, error: 'HTTP 500' });
    const fp = await fetchServerFingerprint('https://broken.example.com', 'u', 'p');
    expect(fp.ping.ok).toBe(false);
    expect(fp.ping.type).toBeNull();
    expect(fp.ping.serverVersion).toBeNull();
    expect(fp.musicFolders).toBeNull();
    expect(fp.userId).toBeNull();
    // Optional calls are skipped entirely once ping fails.
    expect(apiWithCredentials).not.toHaveBeenCalled();
  });
});

describe('verifySameServerEndpoints', () => {
  beforeEach(() => {
    vi.mocked(apiWithCredentials).mockReset();
    vi.mocked(pingWithCredentialsForProfile).mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('short-circuits to ok:true for a single-address profile', async () => {
    const result = await verifySameServerEndpoints(
      { url: 'https://music.example.com' },
      'u',
      'p',
    );
    expect(result).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(pingWithCredentialsForProfile).not.toHaveBeenCalled();
  });

  it('returns ok:true when both endpoints fingerprint the same server', async () => {
    // Both pings succeed; both return identical Navidrome payloads.
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue(navidromeProbe());
    vi.mocked(apiWithCredentials).mockResolvedValue({
      musicFolders: { musicFolder: [{ id: '1', name: 'Music' }] },
    });

    const result = await verifySameServerEndpoints(
      {
        url: 'https://music.example.com',
        alternateUrl: 'http://192.168.0.10',
      },
      'u',
      'p',
    );
    expect(result).toEqual({ ok: true });
    expect(pingWithCredentialsForProfile).toHaveBeenCalledTimes(2);
  });

  it('returns unreachable when one endpoint ping fails', async () => {
    vi.mocked(pingWithCredentialsForProfile)
      .mockResolvedValueOnce(navidromeProbe())
      .mockResolvedValueOnce({ ok: false, error: 'HTTP 500' });
    vi.mocked(apiWithCredentials).mockResolvedValue({});

    const result = await verifySameServerEndpoints(
      {
        url: 'https://music.example.com',
        alternateUrl: 'http://192.168.0.10',
      },
      'u',
      'p',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unreachable');
      expect(result.unreachableHost).toBe('http://192.168.0.10');
    }
  });

  it('verifies a gated public address next to an ungated LAN address', async () => {
    // A Pangolin/Cloudflare-Access-gated public address rejects the token-less
    // CORS preflight that a non-safelisted `Authorization` header provokes, so
    // the WebView fetch never receives a response. Before the fix that read as
    // `unreachable` and blocked the save even though the header was correct.
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue(navidromeProbe());
    vi.mocked(apiWithCredentials).mockResolvedValue({
      musicFolders: { musicFolder: [{ id: '1', name: 'Music' }] },
    });

    const result = await verifySameServerEndpoints(
      {
        url: 'https://music.example.com',
        alternateUrl: 'http://192.168.0.10:4533',
        customHeaders: [{ name: 'Authorization', value: 'Basic dXNlcjpwYXNz' }],
        customHeadersApplyTo: 'public',
      },
      'u',
      'p',
    );

    expect(result).toEqual({ ok: true });
    // Neither address is pinged from the WebView, and both go through the probe.
    expect(fetch).not.toHaveBeenCalled();
    expect(pingWithCredentialsForProfile).toHaveBeenCalledTimes(2);
    const [gated, lan] = vi.mocked(pingWithCredentialsForProfile).mock.calls;
    expect(gated![1]).toBe('https://music.example.com');
    expect(gated![0]).toMatchObject({
      username: 'u',
      password: 'p',
      customHeaders: [{ name: 'Authorization', value: 'Basic dXNlcjpwYXNz' }],
      customHeadersApplyTo: 'public',
    });
    expect(lan![1]).toBe('http://192.168.0.10:4533');
  });

  it('verifies a minimal successful ping envelope as reachable, not unreachable', async () => {
    // An older server can answer `{ status: "ok" }` and omit type / serverVersion
    // / openSubsonic entirely — the Rust client pins that shape in
    // `server_info_falls_back_to_defaults_for_minimal_envelope`. Reachability is
    // keyed on the ping result, so a comparable body signal still verifies.
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue({ ok: true });
    vi.mocked(apiWithCredentials).mockResolvedValue({
      musicFolders: { musicFolder: [{ id: '1', name: 'Music' }] },
    });

    const result = await verifySameServerEndpoints(
      { url: 'https://music.example.com', alternateUrl: 'http://192.168.0.10:4533' },
      'u',
      'p',
    );

    expect(result).toEqual({ ok: true });
  });

  it('returns insufficient, not unreachable, for a minimal envelope with no comparable body signal', async () => {
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue({ ok: true });
    vi.mocked(apiWithCredentials).mockRejectedValue(new Error('Not implemented'));

    const result = await verifySameServerEndpoints(
      { url: 'https://music.example.com', alternateUrl: 'http://192.168.0.10:4533' },
      'u',
      'p',
    );

    expect(result).toEqual({ ok: false, reason: 'insufficient' });
  });

  it('returns mismatch when fingerprints disagree on a body signal', async () => {
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue(navidromeProbe());
    // Two different folder lists.
    vi.mocked(apiWithCredentials)
      .mockResolvedValueOnce({ musicFolders: { musicFolder: [{ id: '1', name: 'Music' }] } })
      .mockResolvedValueOnce({ user: { id: 'tester' } })
      .mockResolvedValueOnce({ license: { email: 'a@e.com' } })
      .mockResolvedValueOnce({
        indexes: { index: [{ name: 'A', artist: [{ id: 'a1' }] }] },
      })
      .mockResolvedValueOnce({ musicFolders: { musicFolder: [{ id: '99', name: 'Other' }] } })
      .mockResolvedValueOnce({ user: { id: 'tester' } })
      .mockResolvedValueOnce({ license: { email: 'a@e.com' } })
      .mockResolvedValueOnce({
        indexes: { index: [{ name: 'A', artist: [{ id: 'a1' }] }] },
      });

    const result = await verifySameServerEndpoints(
      {
        url: 'https://a.example.com',
        alternateUrl: 'https://b.example.com',
      },
      'u',
      'p',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('mismatch');
  });

  it('returns insufficient when pings agree but no body signal is comparable', async () => {
    vi.mocked(pingWithCredentialsForProfile).mockResolvedValue(ampacheProbe());
    // Both servers don't respond to any optional call.
    vi.mocked(apiWithCredentials).mockRejectedValue(new Error('Not implemented'));

    const result = await verifySameServerEndpoints(
      {
        url: 'https://ampache-1.example.com',
        alternateUrl: 'https://ampache-2.example.com',
      },
      'u',
      'p',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient');
  });
});
