/**
 * Native-transport fallback for servers that answer HTTP but send no CORS
 * headers (Bandcamp's Subsonic API, strict reverse proxies).
 *
 * The WebView discards such a response before any handler runs, so `axios`
 * reports a bare "Network Error" with no `response`. These tests pin the
 * recovery: retry once over the native command, remember the address, and keep
 * genuinely different failures (timeouts, real HTTP errors) on their old path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('@/lib/network/subsonicNetworkGuard', () => ({
  shouldAttemptSubsonicForActiveServer: () => true,
  shouldAttemptSubsonicForServer: () => true,
}));

import axios from 'axios';
import { onInvoke } from '@/test/mocks/tauri';
import { pingWithCredentialsForProfile } from '@/lib/api/subsonic';
import { apiWithCredentials } from '@/lib/api/subsonicClient';
import { clearNativeTransportFallback } from '@/lib/server/nativeTransportFallback';

const BASE = 'https://music.example.com';

const PROFILE = {
  url: BASE,
  username: 'tester',
  password: 'pw',
};

/** An axios rejection that never received an HTTP response (CORS / dead host). */
function networkError(): Error {
  return new Error('Network Error');
}

/** An axios rejection carrying a real HTTP response. */
function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status },
  });
}

/** An axios timeout — no response either, but retrying natively is pointless. */
function timeoutError(): Error & { code: string } {
  return Object.assign(new Error('timeout of 15000ms exceeded'), {
    code: 'ECONNABORTED',
  });
}

beforeEach(() => {
  clearNativeTransportFallback();
  vi.mocked(axios.get).mockReset();
  vi.mocked(axios.post).mockReset();
});

afterEach(() => {
  clearNativeTransportFallback();
  vi.restoreAllMocks();
});

describe('connect probe — CORS-less server', () => {
  it('retries natively when the WebView ping dies without an HTTP response', async () => {
    vi.mocked(axios.get).mockRejectedValue(networkError());
    let probes = 0;
    onInvoke('probe_server_connection', () => {
      probes += 1;
      return { ok: true, type: 'BandcampServer', serverVersion: '1.0', openSubsonic: true };
    });

    const result = await pingWithCredentialsForProfile(PROFILE, BASE);

    expect(result.ok).toBe(true);
    expect(result.type).toBe('BandcampServer');
    expect(probes).toBe(1);
  });

  it('sends no header context when the profile has no custom headers', async () => {
    vi.mocked(axios.get).mockRejectedValue(networkError());
    let received: { httpContext: unknown } | undefined;
    onInvoke('probe_server_connection', args => {
      received = args as { httpContext: unknown };
      return { ok: true, type: null, serverVersion: null, openSubsonic: false };
    });

    await pingWithCredentialsForProfile(PROFILE, BASE);

    // A plain reqwest probe: no gate headers to forward, so the context is null.
    expect(received?.httpContext).toBeNull();
  });

  it('pins the address so later probes skip the doomed WebView attempt', async () => {
    vi.mocked(axios.get).mockRejectedValue(networkError());
    onInvoke('probe_server_connection', () => ({
      ok: true, type: null, serverVersion: null, openSubsonic: false,
    }));

    await pingWithCredentialsForProfile(PROFILE, BASE);
    const callsAfterFirst = vi.mocked(axios.get).mock.calls.length;
    await pingWithCredentialsForProfile(PROFILE, BASE);

    expect(vi.mocked(axios.get).mock.calls.length).toBe(callsAfterFirst);
  });

  it('does not pin the address when the native probe also fails', async () => {
    vi.mocked(axios.get).mockRejectedValue(networkError());
    onInvoke('probe_server_connection', () => ({
      ok: false, type: null, serverVersion: null, openSubsonic: false, error: 'connection refused',
    }));

    const first = await pingWithCredentialsForProfile(PROFILE, BASE);
    await pingWithCredentialsForProfile(PROFILE, BASE);

    expect(first.ok).toBe(false);
    // Still probing over the WebView: an unreachable host must not be mistaken
    // for a CORS-less one, or a transient outage would pin it forever.
    expect(vi.mocked(axios.get).mock.calls.length).toBe(2);
  });

  it('leaves timeouts on the WebView path', async () => {
    vi.mocked(axios.get).mockRejectedValue(timeoutError());
    let probes = 0;
    onInvoke('probe_server_connection', () => {
      probes += 1;
      return { ok: true, type: null, serverVersion: null, openSubsonic: false };
    });

    const result = await pingWithCredentialsForProfile(PROFILE, BASE);

    expect(result.ok).toBe(false);
    expect(probes).toBe(0);
  });
});

describe('REST calls — once the probe pinned the address', () => {
  // REST calls deliberately do NOT retry on their own: the connect probe runs
  // before them (and on every reachability tick), so it is the one place that
  // learns the property. That keeps the hot path at exactly one request — an
  // unreachable server must not cost two attempts per call.

  async function pinAddress(): Promise<void> {
    vi.mocked(axios.get).mockRejectedValueOnce(networkError());
    onInvoke('probe_server_connection', () => ({
      ok: true, type: null, serverVersion: null, openSubsonic: false,
    }));
    await pingWithCredentialsForProfile(PROFILE, BASE);
  }

  it('routes calls through the native proxy and parses its payload', async () => {
    await pinAddress();
    onInvoke('subsonic_proxy_request', () =>
      JSON.stringify({ 'subsonic-response': { status: 'ok', musicFolders: { musicFolder: [] } } }),
    );

    const data = await apiWithCredentials<{ musicFolders: unknown }>(
      BASE, 'tester', 'pw', 'getMusicFolders.view',
    );

    expect(data.musicFolders).toEqual({ musicFolder: [] });
    // The doomed WebView attempt is skipped entirely (only the probe's own).
    expect(vi.mocked(axios.get).mock.calls.length).toBe(1);
  });

  it('surfaces a server-side failure from the native payload', async () => {
    await pinAddress();
    onInvoke('subsonic_proxy_request', () =>
      JSON.stringify({
        'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } },
      }),
    );

    await expect(
      apiWithCredentials(BASE, 'tester', 'pw', 'getMusicFolders.view'),
    ).rejects.toThrow(/wrong username/i);
  });

  it('leaves untouched addresses on the WebView path', async () => {
    await pinAddress();
    let proxied = 0;
    onInvoke('subsonic_proxy_request', () => {
      proxied += 1;
      return JSON.stringify({ 'subsonic-response': { status: 'ok' } });
    });
    vi.mocked(axios.get).mockResolvedValue({
      data: { 'subsonic-response': { status: 'ok' } },
    });

    await apiWithCredentials('https://other.example.com', 'tester', 'pw', 'getGenres.view');

    expect(proxied).toBe(0);
  });

  it('keeps a real HTTP error on the WebView path', async () => {
    vi.mocked(axios.get).mockRejectedValue(httpError(500));
    let proxied = 0;
    onInvoke('subsonic_proxy_request', () => {
      proxied += 1;
      return JSON.stringify({ 'subsonic-response': { status: 'ok' } });
    });

    await expect(
      apiWithCredentials(BASE, 'tester', 'pw', 'getMusicFolders.view'),
    ).rejects.toThrow();
    expect(proxied).toBe(0);
  });
});
