/**
 * Theme colours as numbers, for the canvases.
 *
 * `arcColor` hands back theme references — `var(--ctp-mauve)` — because the
 * CSS and SVG layers take them verbatim, which is what lets a community theme
 * recolour the whole ring for free. Canvas has no such luxury: `fillStyle`
 * cannot resolve a custom property, and the sparks and the waveform need real
 * channel values.
 *
 * This is not a cosmetic detail. The old reader accepted hex only and returned
 * white for anything else, so it never once parsed a value the palette
 * actually produces — every spark and every waveform stroke on the disc was
 * white, for every track, while the code around it claimed each track threw
 * its own colour.
 */

/** A scratch context, used only to normalise colour syntax. */
let probe: CanvasRenderingContext2D | null | undefined;

/** Unlikely enough that it cannot be mistaken for a real theme colour. */
const SENTINEL = '#010203';

const WHITE: [number, number, number] = [255, 255, 255];

/**
 * Resolve one colour to RGB, following a `var()` to the value on the root.
 *
 * Whatever the theme holds — hex, `rgb()`, `oklch()` — is normalised by
 * handing it to a canvas and reading `fillStyle` back, so the palette is free
 * to change syntax without this needing to know.
 */
export function resolveRgb(color: string): [number, number, number] {
  let value = color.trim();

  const reference = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(value);
  if (reference) {
    const fromTheme = getComputedStyle(document.documentElement)
      .getPropertyValue(reference[1])
      .trim();
    value = fromTheme || (reference[2] ?? '').trim();
  }
  if (!value) return WHITE;

  if (probe === undefined) probe = document.createElement('canvas').getContext('2d');
  if (!probe) return WHITE;

  // An invalid value leaves `fillStyle` untouched, so the sentinel is how an
  // unparseable colour is told apart from one that really is that dark.
  probe.fillStyle = SENTINEL;
  probe.fillStyle = value;
  const normalised = probe.fillStyle;
  if (typeof normalised !== 'string' || normalised === SENTINEL) return WHITE;

  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(normalised);
  if (hex) {
    return [
      Number.parseInt(hex[1], 16),
      Number.parseInt(hex[2], 16),
      Number.parseInt(hex[3], 16),
    ];
  }
  const channels = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(normalised);
  if (channels) {
    return [
      Math.round(Number(channels[1])),
      Math.round(Number(channels[2])),
      Math.round(Number(channels[3])),
    ];
  }
  return WHITE;
}

/**
 * Resolve a whole palette at once.
 *
 * Called when the frame loop starts rather than per frame: `getComputedStyle`
 * is a cheap read but not sixty times a second across a hundred tracks. A
 * theme swapped mid-burn therefore keeps the sparks it started with, which is
 * the right trade for a burn that lasts minutes.
 */
export function resolvePalette(colors: readonly string[]): Map<string, [number, number, number]> {
  return new Map(colors.map(color => [color, resolveRgb(color)]));
}
