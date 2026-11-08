import { dedupeById } from '@/lib/util/dedupeById';

/** What a browse catalog last loaded: the view, and the sync state it was read at. */
export type BrowseCatalogView = { viewKey: string; syncRevision: number };

export type BrowseCatalogPage<T> = {
  items: T[];
  hasMore: boolean;
  nextCursor?: string | null;
};

/**
 * True when only the library changed underneath an unchanged view. The list can
 * then be swapped in place: emptying it first would send the scroll position
 * back to the top on every background sync.
 */
export function isSyncOnlyCatalogChange(
  previous: BrowseCatalogView | null,
  viewKey: string,
  syncRevision: number,
): boolean {
  return previous != null
    && previous.viewKey === viewKey
    && previous.syncRevision !== syncRevision;
}

/**
 * Re-read a catalog from the start until it covers `minItems`, so a refreshed
 * list is at least as long as the one being replaced and the scroll position
 * still has rows under it. Returns null if any page fails; the caller keeps
 * what is on screen.
 */
export async function refetchCatalogWindow<T extends { id: string }>(
  minItems: number,
  chunkSize: number,
  fetchPage: (
    offset: number,
    chunkSize: number,
    cursor: string | null | undefined,
  ) => Promise<BrowseCatalogPage<T> | null>,
): Promise<BrowseCatalogPage<T> | null> {
  let items: T[] = [];
  let cursor: string | null | undefined;
  for (;;) {
    const page = await fetchPage(items.length, chunkSize, cursor);
    if (page == null) return null;
    const merged = dedupeById([...items, ...page.items]);
    const grew = merged.length > items.length;
    items = merged;
    cursor = page.nextCursor;
    if (!page.hasMore || !grew) {
      return { items, hasMore: page.hasMore && grew, nextCursor: cursor };
    }
    if (items.length >= minItems) return { items, hasMore: true, nextCursor: cursor };
  }
}
