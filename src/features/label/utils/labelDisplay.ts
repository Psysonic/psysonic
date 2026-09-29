import type { NdTagValue } from '@/lib/api/navidromeBrowse';

/** Navidrome file tag that holds the record label. */
export const RECORD_LABEL_TAG = 'recordlabel';

/** Bucket for labels that start with neither an A–Z letter nor a digit. */
export const LABEL_OTHER_BUCKET = 'OTHER';

// Zero-width and direction marks that taggers leave behind (e.g. a trailing U+200E).
const INVISIBLE_MARKS = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

/** Record label as shown: invisible marks removed, whitespace trimmed. */
export function cleanLabelName(raw: string): string {
  return raw.replace(INVISIBLE_MARKS, '').trim();
}

/** Letter index bucket: `#` for digits, `A`–`Z`, else `OTHER`. No article stripping. */
export function labelBucket(name: string): string {
  const first = name.normalize('NFD')[0];
  if (!first) return LABEL_OTHER_BUCKET;
  if (/[0-9]/.test(first)) return '#';
  const up = first.toUpperCase();
  return /^[A-Z]$/.test(up) ? up : LABEL_OTHER_BUCKET;
}

export interface LabelEntry {
  id: string;
  name: string;
}

export interface LabelSection {
  bucket: string;
  labels: LabelEntry[];
}

const BUCKET_ORDER = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), LABEL_OTHER_BUCKET];

/**
 * Clean, filter and group tag rows into letter sections. Values that are empty
 * after cleaning are dropped; distinct tag ids are kept apart even when they
 * look alike, since each id is what the album filter matches on.
 */
export function groupLabels(tags: readonly NdTagValue[], query: string): LabelSection[] {
  const needle = query.trim().toLocaleLowerCase();
  const byBucket = new Map<string, LabelEntry[]>();
  for (const tag of tags) {
    const name = cleanLabelName(tag.value);
    if (!name) continue;
    if (needle && !name.toLocaleLowerCase().includes(needle)) continue;
    const bucket = labelBucket(name);
    const list = byBucket.get(bucket) ?? [];
    list.push({ id: tag.id, name });
    byBucket.set(bucket, list);
  }
  return BUCKET_ORDER.flatMap(bucket => {
    const labels = byBucket.get(bucket);
    if (!labels) return [];
    labels.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return [{ bucket, labels }];
  });
}
