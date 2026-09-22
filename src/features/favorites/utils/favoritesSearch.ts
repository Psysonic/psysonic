export function normalizeFavoritesSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function matchesFavoritesSearch(needle: string, ...values: unknown[]): boolean {
  if (!needle) return true;
  return values.some(value => String(value ?? '').toLocaleLowerCase().includes(needle));
}
