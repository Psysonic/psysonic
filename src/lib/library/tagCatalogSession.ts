export interface CatalogReturnState {
  search: string;
  scrollTop: number;
}

/** Genre and mood catalogs share the same session-only return contract. */
export function readTagCatalogReturnState(key: string): CatalogReturnState | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CatalogReturnState> | null;
    if (!parsed || typeof parsed.search !== 'string' || typeof parsed.scrollTop !== 'number'
      || !Number.isFinite(parsed.scrollTop)) return null;
    return { search: parsed.search, scrollTop: Math.max(0, parsed.scrollTop) };
  } catch {
    return null;
  }
}

/** Avoid spreading arbitrarily large catalogs into Math.max's argument list. */
export function tagCatalogPopularityLog(rows: readonly { albumCount: number }[]): number {
  return rows.length ? Math.log(rows.reduce((max, row) => Math.max(max, row.albumCount), 2)) : 1;
}
