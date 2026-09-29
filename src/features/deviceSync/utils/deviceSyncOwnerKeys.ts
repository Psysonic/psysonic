// Structural parameters rather than the store's manifest types: the store
// imports this module, and a type-only edge back would still be a cycle.

/**
 * Rewrites a manifest source key onto a new owner.
 *
 * Keys are `[serverIndexKey, type, id]` JSON triples. Only keys belonging to the
 * outgoing owner are touched — anything else is passed through untouched rather
 * than guessed at, so a malformed or foreign key can never be rewritten into a
 * valid-looking one.
 */
export function repairedManifestSourceKey(
  sourceKey: string,
  previousOwnerServerIndexKey: string,
  nextOwnerServerIndexKey: string,
): string {
  try {
    const parsed = JSON.parse(sourceKey) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 3
      || parsed.some(part => typeof part !== 'string')) return sourceKey;
    if (parsed[0] !== previousOwnerServerIndexKey) return sourceKey;
    return JSON.stringify([nextOwnerServerIndexKey, parsed[1], parsed[2]]);
  } catch {
    return sourceKey;
  }
}

export function repairedManifestFiles<T extends { sourceKeys: string[] }>(
  files: readonly T[],
  previousOwnerServerIndexKey: string,
  nextOwnerServerIndexKey: string,
): T[] {
  return files.map(file => ({
    ...file,
    sourceKeys: file.sourceKeys.map(key => repairedManifestSourceKey(
      key, previousOwnerServerIndexKey, nextOwnerServerIndexKey,
    )),
  }));
}

export function repairedManifestPlaylists<T extends { sourceKey: string }>(
  playlists: readonly T[],
  previousOwnerServerIndexKey: string,
  nextOwnerServerIndexKey: string,
): T[] {
  return playlists.map(playlist => ({
    ...playlist,
    sourceKey: repairedManifestSourceKey(
      playlist.sourceKey, previousOwnerServerIndexKey, nextOwnerServerIndexKey,
    ),
  }));
}
