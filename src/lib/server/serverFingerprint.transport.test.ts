import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import axios from 'axios';
import { onInvoke } from '@/test/mocks/tauri';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { verifySameServerEndpoints } from '@/lib/server/serverFingerprint';
import {
  clearNativeTransportFallback,
  nativeTransportRequiredFor,
} from '@/lib/server/nativeTransportFallback';

const PUBLIC = 'https://music.example.com';
const LOCAL = 'http://192.168.0.10:4533';
const PROFILE = {
  url: PUBLIC,
  alternateUrl: LOCAL,
  customHeaders: [{ name: 'CF-Access-Client-Token', value: 'gate-token' }],
  customHeadersApplyTo: 'public' as const,
};
const CONTEXT = {
  serverId: '',
  appServerId: '',
  endpoints: [{ url: LOCAL, kind: 'local' }, { url: PUBLIC, kind: 'public' }],
  customHeaders: PROFILE.customHeaders,
  customHeadersApplyTo: 'public',
};
const IDENTITY = {
  type: 'BandcampServer', serverVersion: '1.0', openSubsonic: true,
};
const BODY_ENDPOINTS = [
  'getMusicFolders.view', 'getUser.view', 'getLicense.view', 'getIndexes.view',
];

type ProxyRequest = {
  baseUrl: string;
  endpoint: string;
  params: [string, string][];
  httpContext: unknown;
};

/** Only the Axios/Tauri boundary is replaced; ping, auth checks and REST parsing stay real. */
function installNetwork({
  localCors = false,
  mismatchedFolders = false,
  rejectLocalCredentials = false,
} = {}) {
  function response(baseUrl: string, endpoint: string) {
    if (baseUrl !== PUBLIC && baseUrl !== LOCAL) throw new Error(`Unexpected address: ${baseUrl}`);
    const bodies: Record<string, Record<string, unknown>> = {
      'ping.view': { ...IDENTITY, version: '1.16.1' },
      'getMusicFolders.view': {
        musicFolders: {
          musicFolder: [{ id: '1', name: mismatchedFolders && baseUrl === LOCAL ? 'Other' : 'Music' }],
        },
      },
      'getUser.view': { user: { id: 'user-1' } },
      'getLicense.view': { license: { email: 'tester@example.com' } },
      'getIndexes.view': { indexes: { index: [{ name: 'A', artist: [{ id: 'artist-1' }] }] } },
    };
    const body = bodies[endpoint];
    if (!body) throw new Error(`Unexpected endpoint: ${endpoint}`);
    return { 'subsonic-response': { status: 'ok', ...body } };
  }

  vi.mocked(axios.get).mockImplementation(async url => {
    const prefix = `${LOCAL}/rest/`;
    if (!url.startsWith(prefix)) throw new Error(`Unexpected WebView URL: ${url}`);
    const endpoint = url.slice(prefix.length);
    if (!localCors && endpoint === 'ping.view') throw new Error('Network Error');
    return { data: response(LOCAL, endpoint) };
  });
  const probes = vi.fn((_args: unknown) => ({ ok: true, ...IDENTITY }));
  onInvoke('probe_server_connection', probes);
  const proxy = vi.fn((args: unknown) => {
    const { baseUrl, endpoint } = args as ProxyRequest;
    if (rejectLocalCredentials && baseUrl === LOCAL && endpoint === 'getMusicFolders.view') {
      throw new Error('subsonic http status: 500 Internal Server Error');
    }
    return JSON.stringify(response(baseUrl, endpoint));
  });
  onInvoke('subsonic_proxy_request', proxy);
  return { probes, proxy };
}

beforeEach(() => {
  resetAuthStore();
  clearNativeTransportFallback();
  vi.mocked(axios.get).mockReset();
  vi.mocked(axios.post).mockReset();
});

afterEach(() => {
  resetAuthStore();
  clearNativeTransportFallback();
});

describe('same-server verification — real dual-address transport', () => {
  it.each([false, true])('matches a gated public and gate-less local pair (local CORS: %s)', async localCors => {
    const { probes, proxy } = installNetwork({ localCors });

    await expect(verifySameServerEndpoints(PROFILE, 'tester', 'pw')).resolves.toEqual({ ok: true });

    expect(probes).toHaveBeenCalledWith({
      baseUrl: PUBLIC, username: 'tester', password: 'pw', httpContext: CONTEXT,
    });
    expect(nativeTransportRequiredFor(LOCAL)).toBe(!localCors);
    // Taking the gated path is not evidence of a CORS failure on the public address.
    expect(nativeTransportRequiredFor(PUBLIC)).toBe(false);
    const requests = proxy.mock.calls.map(([args]) => args as ProxyRequest);
    const publicRequests = requests.filter(r => r.baseUrl === PUBLIC);
    expect(new Set(publicRequests.map(r => r.endpoint))).toEqual(new Set(BODY_ENDPOINTS));
    for (const request of requests) {
      expect(request.httpContext).toEqual(CONTEXT);
      expect(request.params).toContainEqual(['u', 'tester']);
      if (request.endpoint === 'getUser.view') {
        expect(request.params).toContainEqual(['username', 'tester']);
      }
    }
    for (const [url, config] of vi.mocked(axios.get).mock.calls) {
      expect(url.startsWith(`${LOCAL}/rest/`)).toBe(true);
      expect(config?.headers).toEqual({});
      expect(config?.params).toEqual(expect.objectContaining({ u: 'tester' }));
    }

    const localRequests = requests.filter(r => r.baseUrl === LOCAL);
    if (localCors) {
      expect(probes).toHaveBeenCalledTimes(1);
      expect(localRequests).toEqual([]);
      // Includes the Bandcamp credential call as well as the optional body queries.
      const endpoints = vi.mocked(axios.get).mock.calls.map(([url]) => url.slice(`${LOCAL}/rest/`.length));
      expect(new Set(endpoints)).toEqual(new Set(['ping.view', ...BODY_ENDPOINTS]));
    } else {
      expect(probes).toHaveBeenCalledTimes(2);
      expect(probes).toHaveBeenCalledWith({
        baseUrl: LOCAL, username: 'tester', password: 'pw', httpContext: CONTEXT,
      });
      expect(axios.get).toHaveBeenCalledExactlyOnceWith(`${LOCAL}/rest/ping.view`, expect.any(Object));
      expect(new Set(localRequests.map(r => r.endpoint))).toEqual(new Set(BODY_ENDPOINTS));
    }
  });

  it('still rejects a body fingerprint mismatch after both addresses authenticate', async () => {
    const { proxy } = installNetwork({ mismatchedFolders: true });

    await expect(verifySameServerEndpoints(PROFILE, 'tester', 'pw')).resolves.toEqual({
      ok: false, reason: 'mismatch',
    });
    const requests = proxy.mock.calls.map(([args]) => args as ProxyRequest);
    for (const baseUrl of [PUBLIC, LOCAL]) {
      expect(new Set(requests.filter(r => r.baseUrl === baseUrl).map(r => r.endpoint)))
        .toEqual(new Set(BODY_ENDPOINTS));
    }
  });

  it('rejects the pair when Bandcamp ping succeeds but local credentials fail', async () => {
    const { probes, proxy } = installNetwork({ rejectLocalCredentials: true });

    await expect(verifySameServerEndpoints(PROFILE, 'tester', 'wrong')).resolves.toEqual({
      ok: false, reason: 'unreachable', unreachableHost: LOCAL,
    });
    expect(probes).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: LOCAL, password: 'wrong' }));
    const localRequests = proxy.mock.calls.map(([args]) => args as ProxyRequest)
      .filter(r => r.baseUrl === LOCAL);
    // No optional fingerprint calls after the failed authenticated request.
    expect(localRequests).toEqual([expect.objectContaining({
      endpoint: 'getMusicFolders.view',
      httpContext: CONTEXT,
      params: expect.arrayContaining([['u', 'tester']]),
    })]);
  });
});
