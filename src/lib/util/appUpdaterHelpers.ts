import { IS_LINUX, IS_MACOS, IS_WINDOWS } from '@/lib/util/platform';

export const SKIP_KEY = 'psysonic_skipped_update_version';

function parseVersion(version: string): [number, number, number, number, number] {
  const match = version.replace(/^[^0-9]*/, '').match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return [0, 0, 0, 0, 0];
  const prerelease = match[4];
  if (!prerelease) return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0), 2, 0];
  const rc = prerelease.match(/^rc\.(\d+)$/);
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3] ?? 0),
    rc ? 1 : 0,
    rc ? Number(rc[1]) : 0,
  ];
}

// Numeric app-version comparison. Pre-release suffixes are intentionally
// ignored because theme floors and legacy contributor versions use this helper.
export function isNewer(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return false;
}

// Release-channel comparison: dev < rc.N < stable within one release line.
export function isNewerRelease(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return false;
}

// Windows updates ship through WinGet, which moderates each new release for a
// while after the GitHub release goes live (installer scan + manual review,
// longer for freshly signed binaries building SmartScreen reputation). Holding
// the update notice back until the release clears this window avoids pointing
// Windows users at a version WinGet has not published yet. Measured from release
// publish to winget-pkgs merge — the same span this guard checks — 1.49.0
// took 1h23, 1.50.0 1h02 and 1.51.0 1h58. The last of those was submitted by
// hand after the automation failed, and still cleared within two hours because
// the submission followed quickly. Twelve hours covers the automated path with
// wide margin instead of holding the notice back for two days. It does not
// cover an unattended failure — a release published late at night and only
// submitted the next morning can exceed this window, and the notice would then
// appear before WinGet has the version.
export const WINGET_MODERATION_DELAY_MS = 12 * 60 * 60 * 1000;

// True while `publishedAt` is younger than `windowMs` relative to `now`.
// Missing or unparseable date → false (fail open: show the notice rather than
// hide it indefinitely). Platform-agnostic so the time logic stays testable.
export function isWithinModerationWindow(
  publishedAt: string | undefined,
  now: number,
  windowMs: number = WINGET_MODERATION_DELAY_MS,
): boolean {
  if (!publishedAt) return false;
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) return false;
  return now - published < windowMs;
}

export interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface ReleaseData {
  version: string;
  tag: string;
  body: string;
  assets: GithubAsset[];
}

export type DlState = 'idle' | 'downloading' | 'done' | 'error';

export function pickAsset(assets: GithubAsset[]): GithubAsset | undefined {
  if (IS_WINDOWS) {
    return assets.find(a => a.name.endsWith('-setup.exe'))
      ?? assets.find(a => a.name.endsWith('.exe'));
  }
  if (IS_MACOS) {
    // Prefer Apple Silicon, fall back to Intel
    return assets.find(a => a.name.endsWith('.dmg') && a.name.includes('aarch64'))
      ?? assets.find(a => a.name.endsWith('.dmg'));
  }
  if (IS_LINUX) {
    // AppImage > deb > rpm
    return assets.find(a => a.name.endsWith('.AppImage'))
      ?? assets.find(a => a.name.endsWith('.deb'))
      ?? assets.find(a => a.name.endsWith('.rpm'));
  }
  return undefined;
}
