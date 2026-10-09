/**
 * OpenSubsonic `explicitStatus`: `"explicit"`, `"clean"` or `""`. Only an
 * explicit track is marked; `clean` and an unset value look the same.
 */
export function isExplicit(entity: { explicitStatus?: string } | null | undefined): boolean {
  return entity?.explicitStatus === 'explicit';
}

/** An album counts as explicit once one of its tracks is — the rule OpenSubsonic servers use for albums. */
export function hasExplicitTrack(tracks: readonly { explicitStatus?: string }[]): boolean {
  return tracks.some(isExplicit);
}
