/**
 * Colours the disc arcs and their track rows share.
 *
 * Six of the theme's accents rather than every one of them. Teal and lavender
 * used to be in here too, and they were what made a full disc read as a grey
 * smear: against sky and green, teal is a shade rather than a colour, and
 * lavender sits so close to mauve that neighbouring tracks stopped separating.
 * These six are the widest spread the palette offers, so every community theme
 * still recolours the ring for free without the ring losing its legibility.
 *
 * Lives outside the component file so fast refresh keeps working for the disc
 * and the running order alike.
 */
const ARC_COLORS = [
  'var(--ctp-mauve)',
  'var(--ctp-peach)',
  'var(--ctp-sky)',
  'var(--ctp-green)',
  'var(--ctp-pink)',
  'var(--ctp-yellow)',
];

/** Stable colour for the track at `index`, cycling once the palette runs out. */
export function arcColor(index: number): string {
  return ARC_COLORS[index % ARC_COLORS.length];
}

/** Every colour the ring can use, for resolving them to pixels up front. */
export function arcPalette(): readonly string[] {
  return ARC_COLORS;
}
