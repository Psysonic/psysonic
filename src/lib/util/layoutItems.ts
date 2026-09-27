/**
 * Shared rehydrate step for the persisted `{ id, visible }[]` layouts behind the
 * Personalisation customizers (page action bars, layout sections).
 */

export type LayoutItem<Id extends string> = { id: Id; visible: boolean };

/**
 * Brings a persisted layout up to the current id set while keeping the user's
 * order and visibility: corrupt entries, unknown ids and duplicates are dropped,
 * and every missing default is inserted right after its nearest default
 * predecessor that is present — at the front when none is. A button added to
 * an existing bar therefore lands where the default order puts it, not at the
 * end of a list the user has already arranged.
 */
export function mergeLayoutItems<Id extends string>(
  raw: unknown,
  defaults: readonly LayoutItem<Id>[],
): LayoutItem<Id>[] {
  const known = new Set<string>(defaults.map(d => d.id));
  const seen = new Set<string>();
  const merged: LayoutItem<Id>[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (
      entry == null
      || typeof entry.id !== 'string'
      || typeof entry.visible !== 'boolean'
      || !known.has(entry.id)
      || seen.has(entry.id)
    ) continue;
    seen.add(entry.id);
    merged.push({ id: entry.id as Id, visible: entry.visible });
  }

  defaults.forEach((def, defIdx) => {
    if (seen.has(def.id)) return;
    let insertAt = 0;
    for (let i = defIdx - 1; i >= 0; i--) {
      const at = merged.findIndex(m => m.id === defaults[i].id);
      if (at >= 0) { insertAt = at + 1; break; }
    }
    merged.splice(insertAt, 0, { ...def });
    seen.add(def.id);
  });

  return merged;
}

/** True when `items` differs from `defaults` in order or visibility. */
export function isLayoutCustomized<Id extends string>(
  items: readonly LayoutItem<Id>[],
  defaults: readonly LayoutItem<Id>[],
): boolean {
  if (items.length !== defaults.length) return true;
  return items.some((it, i) => it.id !== defaults[i].id || it.visible !== defaults[i].visible);
}
