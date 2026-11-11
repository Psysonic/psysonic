import { getDiskSrc, rememberDiskSrc, splitPathVersion } from './diskSrcCache';
import { hasCoverDiskReadyListeners, notifyCoverDiskReady } from './diskHandoff';
import { coverStorageKeyFromRef } from './storageKeys';
import { COVER_ART_TIERS, type CoverArtRef, type CoverArtTier } from './types';

/** Tier embedded in a cover file path (`…/512.webp`, `…/2000-fanart.webp`). */
function coverPathTier(fsPath: string): number | null {
  const m = /(\d+)(?:-[a-z0-9]+)?\.webp$/i.exec(fsPath);
  return m ? Number(m[1]) : null;
}

/** Re-join a (possibly version-stripped) path back into the wire format. */
function joinPathVersion(path: string, version: string): string {
  return version ? `${path}|${version}` : path;
}

/**
 * Never seed the full-res (≥2000) key from a smaller tier's file. The grid lookup
 * order intentionally cross-seeds smaller display keys, but pinning a downscaled
 * image under the 2000 key would make Hero / fullscreen / the lightbox show a
 * small cover (they read the 2000 key before running ensure). Mirrors the Rust
 * `peek_plain_cover_tier` exact-only rule for full-res.
 */
function skipFullResSeedTier(tier: CoverArtTier, fsPath: string): boolean {
  if (tier < 2000) return false;
  const src = coverPathTier(splitPathVersion(fsPath).path);
  return src == null || src < 2000;
}

/**
 * Never seed a display (<2000) key from a full-res (≥2000) file — the mirror
 * direction of {@link skipFullResSeedTier}. A tier-2000 file can be the
 * Navidrome vinyl placeholder (the lightbox's full-res download writes it for a
 * coverless album even after an external-chain HIT, because the chain never
 * writes 2000), and a placeholder pinned under `:800` is exactly the
 * single-frame hero flash: the hero renders vinyl, its next re-ensure peeks the
 * real on-disk 800 and reseeds, flipping back. Seeding only the 2000 key keeps
 * the lightbox's full-res behavior intact while display surfaces never see the
 * placeholder.
 */
function isFullResSeedFile(fsPath: string): boolean {
  const src = coverPathTier(splitPathVersion(fsPath).path);
  return src != null && src >= 2000;
}

/** Dense grids: prefer a larger on-disk tier (800) before tiny thumbs when the ideal tier is missing. */
export function gridDiskSrcLookupOrder(want: CoverArtTier): CoverArtTier[] {
  const out: CoverArtTier[] = [want];
  // Rust peek ladder for tier 64 falls back to 128.webp — mirror that in memory lookup.
  if (want === 64 && !out.includes(128)) out.push(128);
  if (want >= 256 && want < 800) out.push(800);
  const ladder: CoverArtTier[] = [128, 256, 512, 800];
  for (let i = ladder.length - 1; i >= 0; i -= 1) {
    const t = ladder[i]!;
    if (t !== want && t < want && !out.includes(t)) out.push(t);
  }
  if (want < 800 && !out.includes(800)) out.push(800);
  return out;
}

/** Synchronous hit from `diskSrcCache` — any tier already warmed/peeked for this cover. */
export function getDiskSrcForGrid(ref: CoverArtRef, wantTier: CoverArtTier): string {
  for (const tier of gridDiskSrcLookupOrder(wantTier)) {
    const src = getDiskSrc(coverStorageKeyFromRef(ref, tier));
    if (src) return src;
  }
  return '';
}

/**
 * True when the peek/ensure for `wantTier` can stop. For a display tier that
 * takes a file of at least `wantTier` px: the wanted key or a larger display
 * key (seeding never stores a smaller file under a larger key). The smaller
 * rungs {@link getDiskSrcForGrid} falls back to are a stand-in picture only —
 * otherwise a sidebar thumb's 128.webp would stay on a 256 grid card for good
 * (#1829). Full-res surfaces keep settling for any tier already in memory.
 */
export function hasDiskSrcForTier(ref: CoverArtRef, wantTier: CoverArtTier): boolean {
  if (wantTier >= 2000) return Boolean(getDiskSrcForGrid(ref, wantTier));
  return COVER_ART_TIERS
    .filter(t => t >= wantTier && t < 2000)
    .some(tier => Boolean(getDiskSrc(coverStorageKeyFromRef(ref, tier))));
}

/**
 * Seed every grid lookup-order key for a path, up to the file's own tier. A
 * full-res (≥2000) file seeds ONLY its own key (see isFullResSeedFile) — a
 * tier-2000 path must never poison display keys. Shared by the peek/ensure seeder and the
 * `cover:tier-ready` seeder, which differ only in how keys are built.
 */
function seedLadderKeys(
  wantTier: CoverArtTier,
  fsPath: string,
  keyFor: (tier: CoverArtTier) => string,
): boolean {
  const { path, version } = splitPathVersion(fsPath);
  const fullResFile = isFullResSeedFile(fsPath);
  const fileTier = coverPathTier(path);
  let hit = false;
  for (const tier of gridDiskSrcLookupOrder(wantTier)) {
    if (fullResFile && tier < 2000) continue;
    if (skipFullResSeedTier(tier, fsPath)) continue;
    // A file only stands in for keys up to its own size: a 128.webp under
    // `:800` would be read as done by every 256/512 cell (#1829).
    if (fileTier != null && tier > fileTier) continue;
    if (rememberDiskSrc(keyFor(tier), joinPathVersion(path, version))) hit = true;
  }
  return hit;
}

/** Seed lookup-order tier keys (512 + 800 fallback path, etc.) — no subscriber wakeups. */
export function seedGridDiskSrcCache(ref: CoverArtRef, wantTier: CoverArtTier, fsPath: string): boolean {
  if (!fsPath) return false;
  return seedLadderKeys(wantTier, fsPath, (tier) => coverStorageKeyFromRef(ref, tier));
}

/**
 * After peek/ensure: seed cache and wake mounted cells once (avoids 4× notify / re-render storms).
 */
export function rememberGridDiskSrc(ref: CoverArtRef, wantTier: CoverArtTier, fsPath: string): boolean {
  const hit = seedGridDiskSrcCache(ref, wantTier, fsPath);
  if (!hit) return false;
  const wantKey = coverStorageKeyFromRef(ref, wantTier);
  if (hasCoverDiskReadyListeners(wantKey)) {
    notifyCoverDiskReady(wantKey, fsPath);
  }
  return true;
}

/** Rust `cover:tier-ready` — seed ladder keys so sparse cells see 800.webp when they want 128. */
export function rememberDiskSrcLadder(
  serverIndexKey: string,
  ref: Pick<CoverArtRef, 'cacheKind' | 'cacheEntityId'>,
  wantTier: CoverArtTier,
  fsPath: string,
): boolean {
  if (!serverIndexKey || !ref.cacheEntityId || !fsPath) return false;
  return seedLadderKeys(wantTier, fsPath, (tier) =>
    `${serverIndexKey}:cover:${ref.cacheKind}:${ref.cacheEntityId}:${tier}`,
  );
}
