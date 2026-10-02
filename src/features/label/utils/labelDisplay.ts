import type { LabelAlbumCountRow } from '@/lib/api/library';

/** Bucket for labels that start with neither an A–Z letter nor a digit. */
export const LABEL_OTHER_BUCKET = 'OTHER';

/** Letter index bucket: `#` for digits, `A`–`Z`, else `OTHER`. No article stripping. */
export function labelBucket(name: string): string {
  const first = name.normalize('NFD')[0];
  if (!first) return LABEL_OTHER_BUCKET;
  if (/[0-9]/.test(first)) return '#';
  const up = first.toUpperCase();
  return /^[A-Z]$/.test(up) ? up : LABEL_OTHER_BUCKET;
}

export interface LabelEntry {
  name: string;
  albumCount: number;
}

export interface LabelSection {
  bucket: string;
  labels: LabelEntry[];
}

const BUCKET_ORDER = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), LABEL_OTHER_BUCKET];

/**
 * One catalog for every server in the browse scope: the same label on two
 * servers (case-insensitive) is one entry whose album counts add up. The index
 * already stores labels trimmed and without invisible marks.
 */
export function mergeLabelCatalogs(catalogs: readonly LabelAlbumCountRow[][]): LabelEntry[] {
  const merged = new Map<string, LabelEntry>();
  for (const catalog of catalogs) {
    for (const row of catalog) {
      const name = row.value.trim();
      if (!name || row.albumCount <= 0) continue;
      const key = name.toLocaleLowerCase();
      const previous = merged.get(key);
      merged.set(key, {
        name: previous?.name ?? name,
        albumCount: (previous?.albumCount ?? 0) + row.albumCount,
      });
    }
  }
  return [...merged.values()];
}

/** Filter and group labels into letter sections, A–Z within each. */
export function groupLabels(labels: readonly LabelEntry[], query: string): LabelSection[] {
  const needle = query.trim().toLocaleLowerCase();
  const byBucket = new Map<string, LabelEntry[]>();
  for (const label of labels) {
    if (needle && !label.name.toLocaleLowerCase().includes(needle)) continue;
    const bucket = labelBucket(label.name);
    const list = byBucket.get(bucket) ?? [];
    list.push(label);
    byBucket.set(bucket, list);
  }
  return BUCKET_ORDER.flatMap(bucket => {
    const entries = byBucket.get(bucket);
    if (!entries) return [];
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return [{ bucket, labels: entries }];
  });
}
