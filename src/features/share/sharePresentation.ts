import type { SubsonicShare, SubsonicShareEntry } from '@/lib/api/subsonicSharing';
import type { TFunction } from 'i18next';

function entryLabel(entry: SubsonicShareEntry): string | null {
  for (const key of ['title', 'name', 'album', 'artist']) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null;
}

export function shareResourceSummary(share: SubsonicShare, t: TFunction): string {
  const entries = share.entry ?? [];
  if (entries.length === 0) return t('shared.noResourceDetails');
  const labels = entries.map(entryLabel).filter((label): label is string => label !== null);
  const preview = labels.slice(0, 3).join(', ');
  const count = t('shared.resources', { count: entries.length });
  if (!preview) return count;
  return labels.length > 3
    ? `${count}: ${preview}, ${t('shared.moreResources', { count: labels.length - 3 })}`
    : `${count}: ${preview}`;
}
