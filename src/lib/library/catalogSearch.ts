import type { SearchResults } from '@/lib/api/subsonicTypes';
import { mergeLiveSearchResults, EMPTY_SEARCH_RESULTS } from './liveSearchLocal';

export interface CatalogSearchSource {
  run: (offset: number, limit: number) => Promise<(SearchResults & { consumed: number }) | null>;
  offset: number;
  hasMore: boolean;
}

/** Each provider owns its cursor: merged/deduplicated row counts are not offsets. */
export async function nextCatalogSearchPage(sources: readonly CatalogSearchSource[], limit: number) {
  const active = sources.filter(source => source.hasMore);
  const settled = await Promise.allSettled(active.map(async source => ({
    source, page: await source.run(source.offset, limit),
  })));
  let results = EMPTY_SEARCH_RESULTS;
  let succeeded = false;
  for (const result of settled) {
    if (result.status !== 'fulfilled' || !result.value.page) continue;
    const { source, page } = result.value;
    succeeded = true;
    source.offset += page.consumed;
    source.hasMore = page.consumed >= limit;
    results = mergeLiveSearchResults(results, page, {
      artists: Infinity, albums: Infinity, songs: Infinity,
    });
  }
  if (!succeeded && active.length) throw new Error('All catalog search providers failed');
  return { results, hasMore: sources.some(source => source.hasMore) };
}
