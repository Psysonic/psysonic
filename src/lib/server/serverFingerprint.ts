/**
 * Same-server verification for dual-address profiles.
 *
 * When a user enters both a LAN and a public address for "their" server, the
 * UI must refuse to save the pair if the two addresses are actually different
 * boxes (e.g. typo, copy-paste mishap, two different Navidromes). We probe
 * each address for an **idempotent fingerprint** — a small read-only snapshot
 * of server identity — and compare them.
 *
 * Subsonic-generic by design: no branch on `type === 'navidrome'`. Whatever
 * the server reports for `ping.view` plus the optional folders / user /
 * license / indexes calls defines the fingerprint. Servers that only respond
 * to `ping.view` produce an "insufficient" result, which blocks save in v1
 * (no "save anyway" escape hatch — see spec §7.3).
 */

import {
  apiWithCredentials,
  type ServerHttpHeaderProfile,
} from '@/lib/api/subsonicClient';
import { pingWithCredentialsForProfile } from '@/lib/api/subsonic';
import type { ServerProfile } from '@/store/authStoreTypes';
import { allNormalizedAddresses } from '@/lib/server/serverEndpoint';

export type ServerFingerprint = {
  ping: {
    /**
     * Whether the server answered `ping` with `status="ok"`. This is the only
     * trustworthy reachability signal: an older server can answer `ok` while
     * omitting `type` / `serverVersion` / `openSubsonic` entirely, so nulls in
     * those fields do **not** mean the address is down.
     */
    ok: boolean;
    type: string | null;
    serverVersion: string | null;
    openSubsonic: boolean;
    apiVersion: string | null;
  };
  musicFolders: Array<{ id: string; name: string }> | null;
  userId: string | null;
  /** Normalized lowercased email if present, else null. */
  licenseKey: string | null;
  indexesDigest: string | null;
};

export type FingerprintCompareResult = 'match' | 'mismatch' | 'insufficient';

export type VerifySameServerResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'mismatch' | 'insufficient' | 'unreachable';
      unreachableHost?: string;
    };

// ─── ping ────────────────────────────────────────────────────────────────────
//
// The ping rides the same probe the connect test uses. A WebView request cannot
// carry a gate header (the browser preflights the non-safelisted header with a
// token-less `OPTIONS` the gate rejects) and cannot read the reply of a server
// that sends no CORS headers at all. Both look identical from here: an
// unreachable address. The probe covers both, and remembers a CORS-less address
// for the rest of the session.
//
// The probe reports the Subsonic envelope `version` as `apiVersion`. It is
// informational in the fingerprint and compared nowhere, but it is kept so a
// fingerprint still says which protocol level the server claimed.

async function fetchPingFingerprint(
  baseUrl: string,
  username: string,
  password: string,
  headerProfile?: ServerHttpHeaderProfile,
): Promise<ServerFingerprint['ping']> {
  const probed = await pingWithCredentialsForProfile(
    { ...(headerProfile ?? { url: baseUrl, alternateUrl: undefined }), username, password },
    baseUrl,
  );
  return {
    ok: probed.ok,
    type: probed.type ?? null,
    serverVersion: probed.serverVersion ?? null,
    openSubsonic: probed.openSubsonic === true,
    apiVersion: probed.apiVersion ?? null,
  };
}

// ─── optional fingerprint calls (failures soft-fail to null) ─────────────────

function extractMusicFolders(data: unknown): Array<{ id: string; name: string }> | null {
  const folders = (data as Record<string, unknown> | null)?.['musicFolders'] as
    | { musicFolder?: Array<{ id: unknown; name: unknown }> }
    | undefined;
  const list = folders?.musicFolder;
  if (!Array.isArray(list)) return null;
  const normalized = list
    .map(f => ({ id: String(f.id ?? ''), name: typeof f.name === 'string' ? f.name : '' }))
    .filter(f => f.id !== '');
  // Sort by id so order differences from the server don't trip the compare.
  normalized.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return normalized;
}

function extractUserId(data: unknown): string | null {
  const user = (data as Record<string, unknown> | null)?.['user'] as
    | Record<string, unknown>
    | undefined;
  if (!user) return null;
  // Only count the server-supplied id as a signal. A username-only fallback
  // (spec §7.2 footnote) would create false `mismatch` results when one
  // endpoint surfaces an explicit id and the other only returns the
  // username we already authenticated with — both sides would carry a
  // value and the comparator would compare unrelated strings.
  const explicit = typeof user.id === 'string' ? user.id.trim() : '';
  return explicit || null;
}

function extractLicenseEmail(data: unknown): string | null {
  const license = (data as Record<string, unknown> | null)?.['license'] as
    | Record<string, unknown>
    | undefined;
  if (!license) return null;
  const email = typeof license.email === 'string' ? license.email.trim().toLowerCase() : '';
  return email || null;
}

function extractIndexesDigest(data: unknown): string | null {
  const indexes = (data as Record<string, unknown> | null)?.['indexes'] as
    | Record<string, unknown>
    | undefined;
  if (!indexes) return null;
  const letters = Array.isArray(indexes.index) ? (indexes.index as Array<Record<string, unknown>>) : [];
  if (letters.length === 0) return null;
  const letterCount = letters.length;
  const artistIds: string[] = [];
  for (const letter of letters) {
    const artists = Array.isArray(letter.artist) ? (letter.artist as Array<Record<string, unknown>>) : [];
    for (const artist of artists) {
      const id = typeof artist.id === 'string' ? artist.id : null;
      if (id) artistIds.push(id);
      if (artistIds.length >= 20) break;
    }
    if (artistIds.length >= 20) break;
  }
  if (artistIds.length === 0) return `letters:${letterCount}|`;
  artistIds.sort();
  return `letters:${letterCount}|${artistIds.slice(0, 20).join(',')}`;
}

// ─── fetchServerFingerprint ──────────────────────────────────────────────────

export async function fetchServerFingerprint(
  baseUrl: string,
  username: string,
  password: string,
  headerProfile?: ServerHttpHeaderProfile,
): Promise<ServerFingerprint> {
  // Ping is required — but we still build a (mostly-null) fingerprint when
  // it fails, carrying `ping.ok` so callers can tell the difference between
  // "server unreachable" (verify reports `unreachable`) and "server reachable
  // but disagrees" (verify reports `mismatch` / `insufficient`).
  const ping = await fetchPingFingerprint(baseUrl, username, password, headerProfile);

  // The optional calls only make sense once ping succeeded — without that,
  // any subsequent call against the same URL is just wasted bandwidth.
  if (!ping.ok) {
    return {
      ping,
      musicFolders: null,
      userId: null,
      licenseKey: null,
      indexesDigest: null,
    };
  }

  const settled = await Promise.allSettled([
    apiWithCredentials<Record<string, unknown>>(
      baseUrl,
      username,
      password,
      'getMusicFolders.view',
      {},
      15000,
      headerProfile,
    ),
    apiWithCredentials<Record<string, unknown>>(
      baseUrl,
      username,
      password,
      'getUser.view',
      { username },
      15000,
      headerProfile,
    ),
    apiWithCredentials<Record<string, unknown>>(
      baseUrl,
      username,
      password,
      'getLicense.view',
      {},
      15000,
      headerProfile,
    ),
    apiWithCredentials<Record<string, unknown>>(
      baseUrl,
      username,
      password,
      'getIndexes.view',
      {},
      15000,
      headerProfile,
    ),
  ]);

  const [foldersResult, userResult, licenseResult, indexesResult] = settled;

  const value = <T>(r: PromiseSettledResult<T>): T | null =>
    r.status === 'fulfilled' ? r.value : null;

  return {
    ping,
    musicFolders: extractMusicFolders(value(foldersResult)),
    userId: extractUserId(value(userResult)),
    licenseKey: extractLicenseEmail(value(licenseResult)),
    indexesDigest: extractIndexesDigest(value(indexesResult)),
  };
}

// ─── compareFingerprints ─────────────────────────────────────────────────────

/**
 * Strict comparison rule for the ping triple, plus a "common-signals" rule
 * for the body. Envelope `apiVersion` is informational only and never causes
 * mismatch on its own (spec §7.3).
 *
 * `match` — every common signal agrees + at least one common body signal
 * `mismatch` — any common signal differs (ping or body)
 * `insufficient` — pings ok but no body signal is present on both sides
 */
export function compareFingerprints(
  a: ServerFingerprint,
  b: ServerFingerprint,
): FingerprintCompareResult {
  // Ping strictness — these MUST agree once both pings succeeded. (Callers
  // upstream of compareFingerprints handle the "ping failed" case as
  // `unreachable`.)
  const aType = a.ping.type?.trim().toLowerCase() ?? null;
  const bType = b.ping.type?.trim().toLowerCase() ?? null;
  if (aType !== bType) return 'mismatch';

  const aVersion = a.ping.serverVersion ?? null;
  const bVersion = b.ping.serverVersion ?? null;
  if (aVersion !== bVersion) return 'mismatch';

  if (a.ping.openSubsonic !== b.ping.openSubsonic) return 'mismatch';

  // Body signals — only count when both sides have a value. Empty array on
  // both sides for musicFolders is itself a matching signal (spec §7.3).
  let common = 0;

  // musicFolders — array equality after sort (extract already sorts).
  if (a.musicFolders !== null && b.musicFolders !== null) {
    common += 1;
    if (!musicFoldersEqual(a.musicFolders, b.musicFolders)) return 'mismatch';
  }

  if (a.userId !== null && b.userId !== null) {
    common += 1;
    if (a.userId !== b.userId) return 'mismatch';
  }

  if (a.licenseKey !== null && b.licenseKey !== null) {
    common += 1;
    if (a.licenseKey !== b.licenseKey) return 'mismatch';
  }

  if (a.indexesDigest !== null && b.indexesDigest !== null) {
    common += 1;
    if (a.indexesDigest !== b.indexesDigest) return 'mismatch';
  }

  if (common === 0) return 'insufficient';
  return 'match';
}

function musicFoldersEqual(
  a: Array<{ id: string; name: string }>,
  b: Array<{ id: string; name: string }>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (ai.id !== bi.id || ai.name !== bi.name) return false;
  }
  return true;
}

// ─── verifySameServerEndpoints ───────────────────────────────────────────────

/**
 * Top-level orchestrator: probe each configured address in parallel, then
 * compare the fingerprints pairwise. Single-address profiles short-circuit to
 * `ok: true` — nothing to verify.
 */
export async function verifySameServerEndpoints(
  profile: Pick<
    ServerProfile,
    'url' | 'alternateUrl' | 'customHeaders' | 'customHeadersApplyTo'
  >,
  username: string,
  password: string,
): Promise<VerifySameServerResult> {
  const endpoints = allNormalizedAddresses(profile);
  if (endpoints.length <= 1) return { ok: true };

  const fingerprints = await Promise.all(
    endpoints.map(baseUrl => fetchServerFingerprint(baseUrl, username, password, profile)),
  );

  // If any ping failed → unreachable (with the offending host for the UI).
  // Keyed on `ping.ok`, never on the metadata fields: a minimal envelope that
  // omits `type` / `serverVersion` is a *reachable* server, and belongs in the
  // compare below (where it lands on `match` or `insufficient`).
  for (let i = 0; i < endpoints.length; i++) {
    if (!fingerprints[i]!.ping.ok) {
      return { ok: false, reason: 'unreachable', unreachableHost: endpoints[i]! };
    }
  }

  // Compare every pair. N=2 in v1 (spec §6), but the loop generalises.
  for (let i = 0; i < fingerprints.length; i++) {
    for (let j = i + 1; j < fingerprints.length; j++) {
      const result = compareFingerprints(fingerprints[i]!, fingerprints[j]!);
      if (result === 'mismatch') return { ok: false, reason: 'mismatch' };
      if (result === 'insufficient') return { ok: false, reason: 'insufficient' };
    }
  }

  return { ok: true };
}
