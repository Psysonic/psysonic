/** The single-folder compatibility value read by older Psysonic builds. */
export function legacyFilterFromSelection(libraryIds: readonly string[]): 'all' | string {
  return libraryIds[0] ?? 'all';
}
