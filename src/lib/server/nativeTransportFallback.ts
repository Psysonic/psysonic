import { normalizeServerBaseUrl } from '@/lib/server/serverAddress';

/**
 * Servers that answer HTTP but send no CORS headers (Bandcamp's Subsonic API,
 * plain reverse proxies, self-hosted servers with a strict origin policy).
 *
 * The WebView discards such a response before any handler runs, so `axios`
 * reports a bare "Network Error" with no `response` — indistinguishable from a
 * dead host at the call site. The native `reqwest` stack has no origin policy
 * and answers fine, which is why streaming and cover art already work against
 * these servers while every REST call fails.
 *
 * Once a call has proven that an address needs the native path, it is recorded
 * here and every later request to the same address skips the doomed WebView
 * attempt. Deliberately **session-only and in memory**, mirroring the connect
 * cache in `serverEndpoint.ts`: CORS is a property of the address, not of the
 * saved profile, so it must not travel in shares, magic strings, or persisted
 * state — and re-learning it costs exactly one failed request per address.
 */
const nativeTransportAddresses = new Set<string>();

function addressKey(baseUrl: string): string {
  return normalizeServerBaseUrl(baseUrl);
}

/** True when a previous call proved this address needs the native transport. */
export function nativeTransportRequiredFor(baseUrl: string): boolean {
  const key = addressKey(baseUrl);
  return key !== '' && nativeTransportAddresses.has(key);
}

/** Record that this address only answers over the native stack. */
export function markNativeTransportRequired(baseUrl: string): void {
  const key = addressKey(baseUrl);
  if (key !== '') nativeTransportAddresses.add(key);
}

/**
 * Forget one address (or all). Call when a profile's addresses change, so an
 * edited URL is probed from scratch instead of inheriting the old verdict.
 */
export function clearNativeTransportFallback(baseUrl?: string): void {
  if (baseUrl === undefined) {
    nativeTransportAddresses.clear();
    return;
  }
  nativeTransportAddresses.delete(addressKey(baseUrl));
}
