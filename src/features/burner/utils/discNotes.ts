/**
 * The music notes the write head throws off, as arithmetic.
 *
 * The disc's particle layer lives on a canvas, and jsdom has no canvas at all
 * — `getContext` is not implemented — so anything reachable only through
 * `BurnDisc` cannot be tested. Everything here is the part that has no canvas
 * in it: which glyphs the host can actually draw, how many notes to throw this
 * frame, how big it is, where one leaves the head heading, and what one frame
 * does to it. `BurnDisc` supplies the context and the random numbers and
 * nothing else.
 */

/**
 * The disc width every fixed pixel size in here used to be written at.
 *
 * The particles were sized in literal pixels — a 13-23px glyph, a 1-3px spark
 * — while the disc itself is responsive and runs from about 350px wide in a
 * narrow window to 900-odd in a wide one. So the effect was tuned at one width
 * and got proportionally smaller at every width above it: on a large disc the
 * notes read as specks, which is the fault the reference footage shows.
 *
 * Everything below is a fraction of the disc's width instead, and this is the
 * width at which those fractions come back to the numbers that shipped. A
 * small window is therefore unchanged; only large discs move.
 */
export const PARTICLE_REF_W = 350;

/**
 * How much bigger this disc is than the one the old constants were tuned on.
 *
 * For the quantities that are genuinely a rate rather than a length — a spark's
 * launch speed — where scaling the whole expression is clearer than restating
 * it as a fraction of the width.
 */
export function particleScale(discW: number): number {
  return Math.max(0, discW) / PARTICLE_REF_W;
}

/**
 * The glyph size for one note, as a fraction of the disc.
 *
 * 4.0%-5.3%, measured off the reference frame by frame: on its ~940px disc the
 * notes are 38-50px, and at `PARTICLE_REF_W` the same fractions give 14-19px,
 * which is where they were.
 */
export function noteSize(discW: number, roll: number): number {
  return discW * (0.04 + roll * 0.013);
}

/**
 * The speed that carries a note 16%-27% of the disc's width before it dies.
 *
 * Stated as the distance rather than the speed, and divided by the life the
 * note actually drew, because the two are not independent: a fixed speed and a
 * 0.9-1.7s life spread the travel over nearly a factor of two, and the short-
 * lived notes never got clear of the write head. Working back from the reach
 * makes every note cover the same band of the disc whatever its lifetime.
 */
export function noteSpeed(discW: number, life: number, roll: number): number {
  if (!(life > 0)) return 0;
  return (discW * (0.16 + roll * 0.11)) / life;
}

/**
 * A spark's side, as a fraction of the disc.
 *
 * 0.4%-0.7%. In the reference these are small chunky squares rather than the
 * pinpricks a fixed 1-3px becomes on a wide disc.
 */
export function sparkSize(discW: number, roll: number): number {
  return discW * (0.004 + roll * 0.003);
}

/** A spark's launch speed: the range that shipped, scaled to this disc. */
export function sparkSpeed(discW: number, roll: number): number {
  return (40 + roll * 120) * particleScale(discW);
}

/**
 * Notes alive at once.
 *
 * Higher than the sparks' ceiling on purpose: a note is a slow, large, legible
 * object where a spark is a two-pixel streak, and the reference this was built
 * against shows fifteen-odd in the air at once during a track change.
 */
export const MAX_NOTES = 48;

/** Thrown in one go as the head crosses into a new track. */
export const TRACK_CHANGE_NOTES = 16;

/**
 * The chance of one steady-state note per frame.
 *
 * Still sparser than a burst — that is what keeps a track change readable as
 * an event — but not as sparse as it was. At 0.07 and a ~1.3s life the disc
 * held about five notes in the air, against the ten to eighteen the reference
 * shows during continuous writing, so the effect read as an occasional stray
 * rather than as something coming off the laser. `MAX_NOTES` is the ceiling
 * that keeps the doubled rate from becoming a screensaver.
 */
export const STEADY_NOTE_CHANCE = 0.15;

/**
 * The four glyphs, and the stack that has to draw them.
 *
 * Quarter, eighth, beamed eighths, beamed sixteenths — all four in the
 * Miscellaneous Symbols block, which is covered by Segoe UI Symbol on Windows,
 * Apple Symbols on macOS and DejaVu Sans on Linux. None of them is an emoji,
 * so no colour-emoji substitution happens and no U+FE0E is needed.
 *
 * The Musical Symbols block at U+1D100-U+1D1FF is NOT an option, however much
 * better its notes look: macOS has it and Linux has no coverage at all, so it
 * would render perfectly on the machine it was written on and as tofu boxes
 * for everyone else.
 *
 * `"Noto Sans Symbols 2"` carries the space — that is the family's real name,
 * and the unspaced form matches nothing. DejaVu Sans stays last before the
 * generic because on a Linux box with no Noto symbol fonts installed it is
 * what every earlier name falls back to anyway, and it does carry all four.
 */
export const NOTE_GLYPHS: readonly string[] = ['\u2669', '\u266A', '\u266B', '\u266C'];
export const NOTE_FONT =
  '"Segoe UI Symbol", "Apple Symbols", "Noto Music", "Noto Sans Symbols 2", '
  + '"DejaVu Sans", sans-serif';

/**
 * A codepoint no font maps, used to learn what a miss looks like.
 *
 * U+2FE0 sits in the unassigned gap after the Kangxi radicals. Nothing covers
 * it, so whatever width the winning font reports for it is that font's
 * `.notdef` advance — which is also the width it reports for any glyph it is
 * missing. That is the whole trick.
 */
export const ABSENT_GLYPH = '\u2FE0';

/** Widths this close are the same width; a text measurement is a float. */
const WIDTH_EPSILON = 0.01;

/**
 * The glyphs this host can actually draw, decided once at startup.
 *
 * Load-bearing rather than decorative: the stack above names five families and
 * any given machine will be missing most of them, so which font ends up
 * drawing — and therefore which of the four notes exist — is only knowable at
 * runtime. Measured against the same font string the notes are drawn with, or
 * it answers for a font nobody is using.
 *
 * If every glyph measures as a miss, the font is telling us nothing useful
 * (a fixed-advance fallback answers identically for everything), so the full
 * set is kept rather than the effect being silently switched off.
 */
export function usableGlyphs(
  width: (text: string) => number,
  glyphs: readonly string[] = NOTE_GLYPHS,
): string[] {
  const missing = width(ABSENT_GLYPH);
  if (!Number.isFinite(missing) || missing <= 0) return [...glyphs];
  const drawable = glyphs.filter(glyph => Math.abs(width(glyph) - missing) > WIDTH_EPSILON);
  return drawable.length > 0 ? drawable : [...glyphs];
}

/** One note in flight, in the spark canvas's own pixel space. */
export interface NoteParticle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number;
  rotation: number; spin: number;
  glyph: string; rgb: [number, number, number];
}

/**
 * How many notes to throw this frame, already capped.
 *
 * The cap is applied here rather than at the call site because that is where
 * it kept being forgotten: a ceiling that is only ever written down as a
 * constant is not a ceiling.
 */
export function notesToEmit(crossed: boolean, alive: number, roll: number): number {
  const wanted = crossed ? TRACK_CHANGE_NOTES : roll < STEADY_NOTE_CHANCE ? 1 : 0;
  return Math.max(0, Math.min(wanted, MAX_NOTES - alive));
}

/**
 * The velocity a note leaves the write head with.
 *
 * Radial plus tangential, not radial alone: a note on a pure spoke reads as
 * something raining onto the disc, where one that also carries the head's own
 * direction of travel reads as something escaping the laser. `sway` is signed,
 * so notes leave to both sides of the head rather than all trailing it.
 *
 * The tangential term is exactly perpendicular to the radial one, which is
 * what guarantees the outward component is `speed` whatever the sway does.
 */
export function noteVelocity(rad: number, sway: number, speed: number): { vx: number; vy: number } {
  const rx = Math.cos(rad);
  const ry = Math.sin(rad);
  return {
    vx: rx * speed + -ry * speed * sway,
    vy: ry * speed + rx * speed * sway,
  };
}

/**
 * Advance one note by `dt` seconds. False once it has expired.
 *
 * `vy` is pushed upward rather than down — these are notes leaving an object,
 * not debris falling off one — and only `vx` is dragged, so the rise holds
 * while the sideways travel settles.
 */
export function stepNote(note: NoteParticle, dt: number): boolean {
  note.life -= dt;
  if (note.life <= 0) return false;
  note.vx *= 0.992;
  note.vy -= 7 * dt;
  note.x += note.vx * dt;
  note.y += note.vy * dt;
  note.rotation += note.spin * dt;
  return true;
}

/**
 * How opaque a note is now.
 *
 * Full for most of its flight and fading only at the end: notes that faded
 * linearly from birth were already half gone by the time the eye found them.
 */
export function noteAlpha(note: Pick<NoteParticle, 'life' | 'max'>): number {
  if (note.max <= 0) return 0;
  return Math.max(0, Math.min(1, (note.life / note.max) * 2.5));
}

/**
 * How opaque a note's WHITE core is now.
 *
 * Deliberately steeper than `noteAlpha`, which the coloured halo uses. A note
 * in the reference is born white-hot inside a coloured glow and dies as the
 * track's colour: the white is the newest part of it, and it is the white that
 * has to leave first for that to read. Squaring the remaining life is what
 * pulls the core out from under the halo — at half life the halo is still at
 * full strength and the core is down to a quarter.
 *
 * Multiplied through `noteAlpha` rather than computed beside it, so the core
 * can never outlive the note it belongs to however the fade is retuned.
 */
export function noteCoreAlpha(note: Pick<NoteParticle, 'life' | 'max'>): number {
  if (note.max <= 0) return 0;
  const left = Math.max(0, Math.min(1, note.life / note.max));
  return noteAlpha(note) * left * left;
}

/**
 * The shadow radius that puts a soft halo roughly twice the glyph's size
 * around it.
 *
 * Taken from the size the note is actually DRAWN at — its base size times its
 * growth — and not from a constant. A constant blur is a halo that shrinks
 * relative to the glyph as the glyph grows, which is how notes on a large disc
 * came out as flat white symbols with no light around them at all.
 */
export function noteGlowBlur(drawnSize: number): number {
  return drawnSize * 0.5;
}

/** A note swells slightly as it goes, so fading reads as receding. */
export function noteGrowth(note: Pick<NoteParticle, 'life'>): number {
  return 1 + (1 - note.life) * 0.18;
}

/** The little of a 2D context that wiping one needs. */
export interface ClearableContext {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

/**
 * Wipe a canvas's whole backing store, whatever transform it is carrying.
 *
 * The identity reset is the entire point of this function, and it is not
 * defensive tidying. `clearRect` is a TRANSFORMED operation: it takes user
 * coordinates, not device ones. The frame loop leaves the spark context under
 * `setTransform(dpr, 0, 0, dpr, padX * dpr, padY * dpr)` — the offset that
 * pushes the drawing origin back over the disc after the canvas is inflated to
 * let particles escape it — and a 2D context belongs to its canvas element, so
 * that transform is still in force the next time anything touches it, including
 * the teardown that runs after the burn is over and `getContext` is called
 * afresh.
 *
 * Clearing `(0, 0, width, height)` through it therefore starts at the padded
 * origin and leaves a band `padX` wide down the left edge and `padY` tall
 * across the top untouched. That band is precisely the margin above the disc's
 * rim, and any note still in flight there when the drive finished stayed on
 * screen, frozen, until the page was left — which is what was reported after a
 * completed burn ejected its disc.
 */
export function clearCanvas(ctx: ClearableContext, width: number, height: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
}
