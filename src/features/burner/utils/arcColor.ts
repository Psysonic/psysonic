/**
 * Colours the disc arcs and their track rows share.
 *
 * Drawn from the theme's accent set so every community theme recolours the
 * ring for free. Lives outside the component file so fast refresh keeps
 * working for `DiscRing`.
 */
const ARC_COLORS = [
  'var(--ctp-mauve)',
  'var(--ctp-sky)',
  'var(--ctp-peach)',
  'var(--ctp-green)',
  'var(--ctp-pink)',
  'var(--ctp-yellow)',
  'var(--ctp-lavender)',
  'var(--ctp-teal)',
];

/** Stable colour for the track at `index`, cycling once the palette runs out. */
export function arcColor(index: number): string {
  return ARC_COLORS[index % ARC_COLORS.length];
}
