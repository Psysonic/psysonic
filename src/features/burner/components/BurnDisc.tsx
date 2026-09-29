import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatDuration, sectorsToSeconds, type DiscLayout,
} from '@/features/burner/utils/capacity';
import {
  annularSector, capacityAngle, discGeometry, polar, programAreaSectors, sliceAtAngle, wedgeEnd,
} from '@/features/burner/utils/discGeometry';
import { arcColor, arcPalette } from '@/features/burner/utils/arcColor';
import { resolvePalette, resolveRgb } from '@/features/burner/utils/arcRgb';
import {
  NOTE_FONT, clearCanvas, noteAlpha, noteCoreAlpha, noteGlowBlur, noteGrowth, noteSize,
  noteSpeed, noteVelocity, notesToEmit, particleScale, sparkSize, sparkSpeed, stepNote,
  usableGlyphs, type NoteParticle,
} from '@/features/burner/utils/discNotes';
import type { BurnPhase } from '@/features/burner/store/burnJobStore';

export interface BurnDiscProps {
  layout: DiscLayout;
  /** Highlighted from the track list, so the two stay paired. */
  hoveredIndex: number | null;
  phase: BurnPhase | null;
  sectorsDone: number;
  /** What the drive was told to expect, for measuring the prepare phases. */
  sectorsTotal: number;
  /** 0-based track being fetched or rendered, while that is the phase. */
  trackIndex: number | null;
  trackTotal: number;
  busy: boolean;
  /**
   * A rehearsal. Drawn identically to a real burn on purpose — it exists to
   * show what the real one will do — and named as one in the hub instead.
   */
  testWrite: boolean;
  finished: boolean;
}

/** Particles alive at once. Restraint is the whole effect; hundreds is a screensaver. */
const MAX_SPARKS = 120;

/** Thrown in one go as the head crosses into a new track. */
const BURST_SPARKS = 40;

/**
 * How far the particle canvas is allowed to reach past the disc's own box,
 * as a fraction of that box. It MUST match `--burn-spill` in `burner.css`,
 * which is what actually inflates the element; this is only how the drawing
 * origin is put back over the disc's centre afterwards.
 *
 * The canvas used to be inscribed in the well exactly like the disc, so a
 * particle leaving at twelve o'clock hit the edge of its own canvas within a
 * few pixels while one leaving at four o'clock had the corner's extra room to
 * travel through — the same effect looked completely different depending on
 * where in the burn it happened. Inflating the box by a fixed margin gives
 * every angle the same room. Nothing about the disc moves: the drawing origin
 * is offset by exactly what the box grew by.
 */
const SPARK_SPILL = 0.16;

/**
 * The hub's pulse, in milliseconds, and where its two turning points fall.
 *
 * One breath: rest, a bright peak a little before halfway, a quick settle
 * behind it, then back to rest. Driven from the Web Animations API rather than
 * the frame loop — it is a fixed cycle that owes nothing to what the drive is
 * doing, so it has no business costing a frame's work.
 */
const HUB_PULSE_MS = 2300;
const HUB_PEAK = 0.42;
const HUB_SETTLE = 0.58;

/**
 * The hub's glow colour, which is CONSTANT, at its two strengths.
 *
 * Not `--burn-lead`. The hub is the page speaking, not the disc: it reads
 * lavender while a green track is being written, and that is deliberate — the
 * track's colour already has the whole ring, the bloom and the write head to
 * itself. Every theme defines `--accent`, and the literal behind it is there
 * because an unresolvable `var()` is invalid at computed-value time and would
 * take the entire keyframe with it, silently.
 *
 * Two strengths and not one because the cycle used to start and end at
 * `drop-shadow(0 0 0 transparent)` — no halo whatsoever for most of every
 * breath, and a flash at the peak. The reference carries a lavender halo in
 * every single frame: sampled just outside the hub it sits at about
 * rgb(67,60,119) at rest and rgb(139,117,186) at peak, which is a doubling in
 * brightness rather than something switching on. `_REST` is that floor.
 */
const HUB_GLOW = 'color-mix(in srgb, var(--accent, #cba6f7) 62%, transparent)';
const HUB_GLOW_REST = 'color-mix(in srgb, var(--accent, #cba6f7) 30%, transparent)';

/**
 * The ring, in the surface box's own units — the SVG viewBox, where the disc
 * surface is a circle of radius 50 centred on 50,50.
 */
const R_IN = 22.8;
const R_OUT = 48.5;

/**
 * The rest of the disc, outside in, in those same viewBox units.
 *
 * A pressed CD's most recognisable feature after the hole is the stacking
 * ring, and the band between the hub and the program area was dead black. The
 * bezel closes the hub's edge, the clamp marks where the drive grips, the
 * mirror is the unrecorded inner surface, and the two rim circles give the
 * disc a polished edge rather than a fill that simply stops.
 *
 * Each band is clear of its neighbours once its stroke is spent. The hub is
 * painted to 17.03 and the widest of these ends at 20.65, below the lead-in's
 * 20.90 and well below the program area's 22.60. They are in viewBox units and
 * not page pixels for the reason the halo rings they replace were wrong: the
 * disc is scaled by a transform now, so anything measured in page pixels holds
 * the wrong proportion at every size but one.
 */
const R_BEZEL = 17.6;
const R_CLAMP = 18.6;
const R_MIRROR = 19.9;
const R_LEADIN = 21.5;
const R_RIM_IN = 48.95;
const R_RIM = 49.6;

/** How far the over-capacity marker stands proud of the program area. */
const OVERRUN_MARK_OVERHANG = 3;

/**
 * Gradient painting the unwritten program area, referenced from CSS.
 *
 * A flat stroke made the empty ring a uniform grey band; falling off toward
 * the rim gives the disc somewhere to sit under the light the surface casts.
 */
const REST_GRADIENT_ID = 'burnRest';

/**
 * The gradient's own radius. It is stated in user units so its stops can be
 * written as the ring radii divided by it, which keeps them tied to `R_IN`
 * and `R_OUT` instead of being two decimals nobody would think to update.
 */
const REST_GRADIENT_R = 50;

/**
 * The same two radii as a fraction of the whole disc box, for the canvases.
 * They sit on `.burn-disc`, one level out from the surface, which CSS insets
 * by 4.5% — so the surface's radius is 45.5 of the disc's 100.
 */
const SURFACE_R = 45.5;
const R_INNER = ((R_IN / 50) * SURFACE_R) / 100;
const R_OUTER = ((R_OUT / 50) * SURFACE_R) / 100;

/**
 * Degrees of waveform trailing the head.
 *
 * It used to be drawn across everything written so far, which by the end of a
 * disc was a squiggle over the entire ring — it buried the wedges the ring
 * exists to show. Kept to a trail, it reads as heat coming off the laser and
 * leaves the written colour alone.
 */
const WAVE_TRAIL_DEG = 46;

/** The write head: three stacked strokes, widest and haziest first. */
const HEAD_STROKES = [
  { key: 'haze', width: 3.2 },
  { key: 'glow', width: 1.4 },
  { key: 'core', width: 0.55 },
];

interface Spark {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; rgb: [number, number, number];
}

/** The box both canvases fill, in CSS pixels, with the ratio to back it at. */
interface CanvasBox { w: number; h: number; dpr: number }

/**
 * Match a canvas's backing store to the box it is painted into.
 *
 * Assigning either dimension reallocates that store and wipes the canvas, so
 * it may only happen when the measurement has genuinely moved. This used to be
 * done twice per frame from a fresh `getBoundingClientRect()`, which threw
 * both stores away sixty times a second — and which cannot be done at all now
 * the disc is sized by `transform: scale()`, because a client rect comes back
 * scaled and the store would chase the animation instead of the element.
 */
function applySize(canvas: HTMLCanvasElement, box: CanvasBox): void {
  const width = Math.max(1, Math.round(box.w * box.dpr));
  const height = Math.max(1, Math.round(box.h * box.dpr));
  if (Math.abs(canvas.width - width) > 0.5) canvas.width = width;
  if (Math.abs(canvas.height - height) > 0.5) canvas.height = height;
}

/**
 * The disc: a capacity gauge that becomes a burn.
 *
 * The circle is the queue, always — a short queue fills it just as a long one
 * does, because an empty remainder read as a fault rather than as headroom.
 * How much room is left on the loaded disc is said in words instead, in the
 * hub and the drive bar.
 *
 * Drawn as SVG rather than as layered conic gradients. A gradient cannot
 * stroke an edge or hold a gap open, so every wedge boundary came out aliased
 * and every hairline was a hole punched through to the black underneath.
 *
 * The ring is not interactive here. Every track on it is also a row in the list
 * beside it, and that row is focusable, reorderable and carries the same
 * numbers — so putting focus and labels on 99 arcs as well would be duplicate
 * tab-stops for information the user already has a better route to.
 */
export default function BurnDisc({
  layout, hoveredIndex, phase, sectorsDone, sectorsTotal, trackIndex, trackTotal, busy, testWrite,
  finished,
}: BurnDiscProps) {
  const { t } = useTranslation();

  // Only the laser phases light the ring. Fetching and rendering take most of
  // the wall-clock and write nothing, so a lit disc there would claim a burn
  // that has not started.
  const onDisc = phase === 'writing' || phase === 'closing';

  // A finished disc stays lit, and lit to the rim. The overlay used to be torn
  // down the instant the job ended, so the one moment worth looking at — the
  // whole circle written — was the one moment it was never shown.
  const lit = onDisc || finished;

  const geometry = useMemo(
    () => discGeometry(layout.arcs, arcColor, {
      sectorsDone: finished ? Number.MAX_SAFE_INTEGER : onDisc ? sectorsDone : 0,
    }),
    [layout.arcs, onDisc, finished, sectorsDone],
  );

  const active = onDisc ? sliceAtAngle(geometry.slices, geometry.progressAngle) : null;
  const highlight = hoveredIndex !== null ? geometry.slices[hoveredIndex] ?? null : null;
  // Hover is ignored outright while the laser is on. Falling back to it looked
  // harmless, but the head is null at both ends of a burn — before the first
  // sector, and once the last one is written — so pointing at a row during the
  // closing phase moved the highlight off the disc's real position and
  // relabelled the hub's "Track N of M" to whatever the cursor was over.
  const lead = onDisc ? active : highlight;
  const hotIndex = lead?.index ?? null;

  const discRef = useRef<HTMLDivElement>(null);
  const sparkCanvas = useRef<HTMLCanvasElement>(null);
  const waveCanvas = useRef<HTMLCanvasElement>(null);
  const sparks = useRef<Spark[]>([]);
  // Notes ride in the same array-in-a-ref the sparks do, and are stepped and
  // drawn by the same loop on the same canvas. A second loop, a second canvas
  // or a piece of React state per particle would each cost more than the whole
  // effect is worth.
  const notes = useRef<NoteParticle[]>([]);
  const sizeRef = useRef<CanvasBox>({ w: 0, h: 0, dpr: 1 });
  const lastAngle = useRef(0);
  const lastTrack = useRef<number | null>(null);
  // The loop reads these rather than closing over them: the head's colour and
  // the wedge list change on every track, and restarting the animation each
  // time both stutters it and loses the particles mid-flight.
  const leadRef = useRef(lead);
  const slicesRef = useRef(geometry.slices);
  const hubRef = useRef<HTMLDivElement>(null);
  const hubRingRef = useRef<HTMLDivElement>(null);
  const hubShockRef = useRef<HTMLDivElement>(null);

  // One rAF loop for both canvases, running only while the laser is on. It is
  // torn down otherwise, so an idle burner page costs nothing per frame.
  useEffect(() => {
    const spark = sparkCanvas.current;
    const wave = waveCanvas.current;
    if (!spark || !wave || !onDisc) {
      sparks.current = [];
      notes.current = [];
      lastTrack.current = null;
      // Through `clearCanvas`, which resets the transform first, and NOT a
      // bare `clearRect`. The frame loop leaves the spark context carrying the
      // canvas-inflation offset, a 2D context outlives the effect that set it,
      // and `clearRect` takes user coordinates — so clearing (0,0,w,h) through
      // that transform started at the padded origin and left the top and left
      // inflation bands untouched. Notes still in flight above the rim when a
      // burn ended therefore stayed on screen, frozen, after the eject.
      [sparkCanvas.current, waveCanvas.current].forEach(c => {
        const ctx = c?.getContext('2d');
        if (c && ctx) clearCanvas(ctx, c.width, c.height);
      });
      return;
    }

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const sctx = spark.getContext('2d');
    const wctx = wave.getContext('2d');
    if (!sctx || !wctx) return;

    // Resolved once, when the loop starts, rather than per frame. Canvas
    // cannot read a custom property, and the reader this replaced took hex
    // only — so it never parsed a value the palette actually produces, and
    // every spark and every waveform stroke on the disc came out white.
    const palette = resolvePalette(arcPalette());
    const rgbFor = (color: string | undefined): [number, number, number] => {
      if (!color) return [255, 255, 255];
      return palette.get(color) ?? resolveRgb(color);
    };

    // Which of the four notes this machine can actually draw, asked once.
    //
    // The font stack names five families and any given host will be missing
    // most of them, so the font that ends up drawing — and therefore the glyph
    // coverage — is only knowable at runtime. `measureText` answers with the
    // font's `.notdef` advance for a glyph it does not have, so a codepoint
    // nothing maps is what a miss looks like. Measured through the same font
    // string the notes are drawn with, or it answers for a font nobody uses.
    sctx.font = `16px ${NOTE_FONT}`;
    const glyphs = usableGlyphs(text => sctx.measureText(text).width);

    let raf = 0;
    let prev = performance.now();
    let stopped = false;

    // Measured once per resize instead of twice per frame, and measured off
    // the disc's layout box: the disc is scaled by a transform, and both the
    // client rect and the observer's border box would report that scale, so
    // the canvases would be reallocated through every frame of the morph and
    // come out at whatever resolution the animation happened to stop at. The
    // content box is the transform's input, which is what the canvases are
    // laid out against.
    const well = discRef.current;
    const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);
    if (well) {
      // The observer's first callback arrives after the opening frame has
      // already run, so without a seed the first frame of every burn draws
      // into a one-pixel canvas.
      sizeRef.current = { w: well.offsetWidth, h: well.offsetHeight, dpr: pixelRatio() };
    }
    const observer = new ResizeObserver(entries => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) sizeRef.current = { w: rect.width, h: rect.height, dpr: pixelRatio() };
    });
    if (well) observer.observe(well);

    const frame = (now: number) => {
      if (stopped) return;
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;

      const box = sizeRef.current;
      // The spark canvas is the inflated one; the waveform stays inscribed in
      // the disc, because it is drawn on the ring and has nowhere to escape to.
      const padX = box.w * SPARK_SPILL;
      const padY = box.h * SPARK_SPILL;
      applySize(spark, { w: box.w + padX * 2, h: box.h + padY * 2, dpr: box.dpr });
      applySize(wave, box);
      const angle = lastAngle.current;
      const currentLead = leadRef.current;
      const colour = rgbFor(currentLead?.color);

      // ── Sparks and notes, thrown off the write head ───────────────────
      // The origin is pushed in by exactly the margin the element grew by, so
      // every coordinate below is still in the disc's own box and the disc,
      // the waveform and the head land where they always did.
      sctx.setTransform(box.dpr, 0, 0, box.dpr, padX * box.dpr, padY * box.dpr);
      // Stated in the padded coordinates the transform above establishes, so
      // it starts at device (0,0) and spans the WHOLE backing store — the
      // inflated margin included. A clear written as (0, 0, box.w, box.h)
      // would wipe only the disc's own square and leave the margin the
      // particles fly out into holding the last frame.
      sctx.clearRect(-padX, -padY, box.w + padX * 2, box.h + padY * 2);
      if (!reduced) {
        const cx = box.w / 2;
        const cy = box.h / 2;
        const rad = ((angle - 90) * Math.PI) / 180;
        const hx = cx + Math.cos(rad) * box.w * R_OUTER;
        const hy = cy + Math.sin(rad) * box.w * R_OUTER;

        // Crossing into a new track throws a burst in the new colour, so the
        // band change reads as something happening rather than a slow fade.
        const nowTrack = currentLead?.index ?? null;
        const crossed = nowTrack !== null && lastTrack.current !== null
          && nowTrack !== lastTrack.current;
        lastTrack.current = nowTrack;

        // Every dimension below is a fraction of `box.w`, because the disc is
        // responsive and these used to be literal pixels: tuned at a narrow
        // window, they came out as specks on a wide one, which is exactly the
        // fault the reference footage shows.
        const scale = particleScale(box.w);
        const emit = crossed ? BURST_SPARKS : (Math.random() > 0.5 ? 3 : 0);
        if (emit > 0 && sparks.current.length < MAX_SPARKS) {
          for (let i = 0; i < emit; i++) {
            const tangent = rad + (Math.random() - 0.5) * 1.2;
            const speed = sparkSpeed(box.w, Math.random());
            const life = 0.35 + Math.random() * 0.55;
            // The radial nudge is a velocity like the tangential one and is
            // scaled with it, or the spray leans further off the head's own
            // direction the larger the disc gets.
            const push = 22 * scale;
            sparks.current.push({
              x: hx, y: hy,
              vx: Math.cos(tangent) * speed + Math.cos(rad) * push,
              vy: Math.sin(tangent) * speed + Math.sin(rad) * push,
              life, max: life,
              size: sparkSize(box.w, Math.random()),
              rgb: colour,
            });
          }
        }

        // The notes, from the same head position, in the same colour, and on
        // a track change in the NEW track's — `colour` is read from `leadRef`,
        // which the render effect has already moved on.
        const wantNotes = notesToEmit(crossed, notes.current.length, Math.random());
        for (let i = 0; i < wantNotes; i++) {
          const life = 0.9 + Math.random() * 0.8;
          // The speed is worked back from how far the note should reach and
          // the life it actually drew, so every note covers the same band of
          // the disc whatever its lifetime.
          const { vx, vy } = noteVelocity(
            rad, (Math.random() - 0.5) * 1.4, noteSpeed(box.w, life, Math.random()),
          );
          notes.current.push({
            x: hx, y: hy, vx, vy,
            life, max: life,
            size: noteSize(box.w, Math.random()),
            rotation: (Math.random() - 0.5) * 0.7,
            spin: (Math.random() - 0.5) * 1.8,
            glyph: glyphs[Math.floor(Math.random() * glyphs.length)],
            rgb: colour,
          });
        }

        sctx.globalCompositeOperation = 'lighter';
        for (let i = sparks.current.length - 1; i >= 0; i--) {
          const p = sparks.current[i];
          p.life -= dt;
          if (p.life <= 0) { sparks.current.splice(i, 1); continue; }
          p.vx *= 0.985; p.vy *= 0.985; p.vy += 16 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          const alpha = Math.max(0, p.life / p.max);
          sctx.beginPath();
          sctx.moveTo(p.x, p.y);
          sctx.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022);
          sctx.strokeStyle = `rgba(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]},${alpha})`;
          sctx.lineWidth = p.size;
          sctx.stroke();
        }

        // Notes over the sparks, still additive. The glyph body is the core
        // and its shadow is the halo: two coloured passes lay down a bloom
        // about twice the glyph across, then a white pass on top lights the
        // body itself. The two alphas are deliberately on different curves —
        // the white leaves faster than the colour does — so a note is born
        // white-hot and dies as the track's colour rather than staying a flat
        // white symbol for its whole flight.
        sctx.textAlign = 'center';
        sctx.textBaseline = 'middle';
        for (let i = notes.current.length - 1; i >= 0; i--) {
          const n = notes.current[i];
          if (!stepNote(n, dt)) { notes.current.splice(i, 1); continue; }
          const alpha = noteAlpha(n);
          const core = noteCoreAlpha(n);
          const [r, g, b] = n.rgb;
          const drawn = n.size * noteGrowth(n);
          sctx.save();
          sctx.translate(n.x, n.y);
          sctx.rotate(n.rotation);
          sctx.font = `${drawn.toFixed(2)}px ${NOTE_FONT}`;
          // Blur taken from the size the note is DRAWN at, not a constant: a
          // fixed blur is a halo that shrinks against the glyph as the glyph
          // grows, which is how these came out as flat white symbols with no
          // light around them on a large disc.
          sctx.shadowColor = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
          sctx.shadowBlur = noteGlowBlur(drawn);
          sctx.fillStyle = `rgba(${r},${g},${b},${(alpha * 0.5).toFixed(3)})`;
          // Twice, because `lighter` sums the passes and one shadow alone is
          // the faint rim this is replacing.
          sctx.fillText(n.glyph, 0, 0);
          sctx.fillText(n.glyph, 0, 0);
          sctx.shadowBlur = 0;
          sctx.fillStyle = `rgba(255,255,255,${(core * 0.9).toFixed(3)})`;
          sctx.fillText(n.glyph, 0, 0);
          sctx.restore();
        }
        sctx.globalCompositeOperation = 'source-over';
      }

      // ── Waveform trailing the head ────────────────────────────────────
      wctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
      wctx.clearRect(0, 0, box.w, box.h);
      wctx.save();
      wctx.translate(box.w / 2, box.h / 2);
      wctx.globalCompositeOperation = 'lighter';
      const radius = box.w * ((R_INNER + R_OUTER) / 2);
      const band = box.w * (R_OUTER - R_INNER);
      const trailFrom = Math.max(0, angle - WAVE_TRAIL_DEG);
      for (const slice of slicesRef.current) {
        if (slice.startAngle > angle) break;
        const end = Math.min(slice.endAngle, angle);
        const from = Math.max(slice.startAngle, trailFrom);
        if (end <= from) continue;
        const [r, g, b] = rgbFor(slice.color);
        const steps = Math.max(4, Math.floor((end - from) * 1.1));
        for (let j = 0; j < steps; j++) {
          const deg = from + (end - from) * (j / steps);
          const a = ((deg - 90) * Math.PI) / 180;
          const swing = Math.sin(j * 0.9 + now * 0.006 + slice.index * 1.7) * 0.5
            + Math.sin(j * 0.33 + now * 0.003) * 0.5;
          const len = 2 + Math.abs(swing) * band * 0.09;
          // Fades out behind the head, so the trail has a tail rather than an
          // edge where the window happens to start.
          const fade = (deg - trailFrom) / WAVE_TRAIL_DEG;
          const nx = Math.cos(a); const ny = Math.sin(a);
          wctx.beginPath();
          wctx.moveTo(nx * radius - nx * len, ny * radius - ny * len);
          wctx.lineTo(nx * radius + nx * len, ny * radius + ny * len);
          wctx.strokeStyle = `rgba(${r},${g},${b},${(0.4 * fade).toFixed(3)})`;
          wctx.lineWidth = 1.1;
          wctx.stroke();
        }
      }
      wctx.restore();

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      // Both arrays, not one. A particle that outlives the loop it belongs to
      // reappears mid-flight at the top of the next burn.
      sparks.current = [];
      notes.current = [];
    };
  }, [onDisc]);

  /**
   * The hub's pulse.
   *
   * Web Animations rather than React state or a second frame loop: it is a
   * fixed 2.3s cycle that owes nothing to the drive, so it belongs to the
   * compositor and not to the render. Three layers — the hub itself brightens
   * and takes a glow, a ring inside it swells, and a shockwave leaves it — and
   * every one of them is cancelled on the way out, or a second burn stacks a
   * second copy of each on top of the first.
   *
   * The hub deliberately does not scale. A tenth of a percent is enough to put
   * the percentage figure between two device pixels, and the one thing on this
   * page nobody may lose is the number that says how far the burn has got.
   */
  useEffect(() => {
    if (!onDisc) return;
    // The static glow stays — that is the resting state, and it is in the
    // stylesheet. What reduced motion removes is the movement.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const timing: KeyframeAnimationOptions = {
      duration: HUB_PULSE_MS, iterations: Infinity, easing: 'ease-in-out',
    };
    const running: Animation[] = [];
    const start = (el: HTMLDivElement | null, frames: Keyframe[]) => {
      if (!el || typeof el.animate !== 'function') return;
      running.push(el.animate(frames, timing));
    };

    // The rest frames carry a real halo rather than `0 0 0 transparent`, and
    // the ring's floor matches the resting opacity `burner.css` gives it — the
    // animation overrides that declaration for as long as it runs, so a floor
    // set only in the stylesheet is a floor that applies to nothing but
    // reduced motion.
    start(hubRef.current, [
      { offset: 0, filter: `brightness(1) drop-shadow(0 0 7px ${HUB_GLOW_REST})` },
      { offset: HUB_PEAK, filter: `brightness(1.09) drop-shadow(0 0 16px ${HUB_GLOW})` },
      { offset: HUB_SETTLE, filter: `brightness(1.03) drop-shadow(0 0 10px ${HUB_GLOW})` },
      { offset: 1, filter: `brightness(1) drop-shadow(0 0 7px ${HUB_GLOW_REST})` },
    ]);
    start(hubRingRef.current, [
      { offset: 0, transform: 'scale(0.985)', opacity: 0.85 },
      { offset: HUB_PEAK, transform: 'scale(1.04)', opacity: 1 },
      { offset: HUB_SETTLE, transform: 'scale(1.015)', opacity: 0.92 },
      { offset: 1, transform: 'scale(0.985)', opacity: 0.85 },
    ]);
    start(hubShockRef.current, [
      { offset: 0, transform: 'scale(0.84)', opacity: 0 },
      { offset: HUB_PEAK, transform: 'scale(1.08)', opacity: 0.35 },
      { offset: HUB_SETTLE, transform: 'scale(1.2)', opacity: 0.18 },
      { offset: 1, transform: 'scale(1.35)', opacity: 0 },
    ]);

    return () => { for (const animation of running) animation.cancel(); };
  }, [onDisc]);

  // Written after render, not during it: the frame loop reads these every tick
  // and must not be restarted for each new angle, colour or wedge list.
  useEffect(() => {
    lastAngle.current = geometry.progressAngle;
    leadRef.current = lead;
    slicesRef.current = geometry.slices;
  });

  /** The written part of each wedge, clipped to wherever the head has reached. */
  const written = useMemo(() => {
    if (!lit) return [];
    return geometry.slices.flatMap(slice => {
      if (geometry.progressAngle <= slice.startAngle) return [];
      const end = Math.min(wedgeEnd(slice), geometry.progressAngle);
      if (end <= slice.startAngle) return [];
      return [{
        key: slice.key,
        color: slice.color,
        d: annularSector(R_IN, R_OUT, slice.startAngle, end),
      }];
    });
  }, [lit, geometry.slices, geometry.progressAngle]);

  const percent = geometry.scaleSectors > 0
    ? Math.min(100, Math.round((sectorsDone / geometry.scaleSectors) * 100))
    : 0;

  // Only once there is something to measure. The fetch phase reports bytes
  // rather than sectors, so an early zero would read as a burn that had stalled
  // before it started.
  const preparePercent = !onDisc && busy && sectorsTotal > 0 && sectorsDone > 0
    ? Math.min(100, Math.round((sectorsDone / sectorsTotal) * 100))
    : null;

  // Where the loaded disc runs out, on a ring that is the queue. `layout`
  // counts from the front of the disc and the ring counts from zero, so the
  // queue crosses between the two spaces by the one function that names the
  // difference; mixing them is the bug `discGeometry`'s header records.
  const overrunAngle = capacityAngle(programAreaSectors(layout), layout.capacitySectors);

  const style = { '--burn-lead': lead?.color ?? 'var(--accent)' } as CSSProperties;

  const overBy = layout.totalSectors - layout.capacitySectors;
  const hub = onDisc
    ? { kicker: testWrite ? t('burner.phaseRehearsing') : t(`burner.phase.${phase}`),
        big: `${percent}%`,
        note: lead
          ? t('burner.hubTrackOf', { number: lead.index + 1, total: trackTotal })
          : '' }
    : busy && phase
      ? { kicker: t(`burner.phase.${phase}`),
          // Measured, not counted. Rendering runs several tracks at once, so a
          // "4/16" jumped about and went backwards as workers finished out of
          // order; the sector count the backend already reports for this phase
          // only ever rises.
          big: preparePercent !== null
            ? `${preparePercent}%`
            : trackIndex !== null && trackTotal > 0
              ? `${trackIndex + 1}/${trackTotal}`
              : '···',
          note: t(`burner.hubPhaseNote.${phase}`) }
      // An empty queue is not over capacity, whatever the arithmetic says. It
      // used to share a branch with an overfull one and read "OVER BY 0:00" on
      // a page the user had not put anything on yet.
      : layout.arcs.length > 0 && !layout.fits && overBy > 0
        ? { kicker: t('burner.hubOverCapacity'),
            big: formatDuration(sectorsToSeconds(overBy)),
            note: t('burner.hubTrackCount', { count: layout.arcs.length }) }
        : { kicker: t('burner.hubRemaining'),
            big: formatDuration(sectorsToSeconds(layout.remainingSectors)),
            note: t('burner.hubTrackCount', { count: layout.arcs.length }) };

  return (
    <div
      ref={discRef}
      className={[
        'burn-disc',
        onDisc ? 'is-writing' : '',
        busy && !onDisc ? 'is-preparing' : '',
        finished ? 'is-finished' : '',
        layout.arcs.length === 0 ? 'is-empty' : '',
        overrunAngle !== null ? 'is-over' : '',
      ].filter(Boolean).join(' ')}
      style={style}
      role="img"
      aria-label={t('burner.ringLabel', {
        count: layout.arcs.length,
        used: formatDuration(sectorsToSeconds(layout.totalSectors)),
        capacity: formatDuration(sectorsToSeconds(layout.capacitySectors)),
      })}
    >
      {/* The light the disc spills onto the well around it. First child so it
          inherits `--burn-lead` and sits under everything, and outside the
          surface so the surface's own shadows do not have to contain it. */}
      <div className="burn-disc-bloom" aria-hidden="true" />

      <div className="burn-disc-surface">
        {/* Diffraction, under the data layer where it belongs: the wedges are
            drawn well under full opacity — see `.burn-ring-arc` — so the
            rainbow reads through them as it does through a real disc's dye. */}
        <div className="burn-disc-iris" aria-hidden="true" />

        <svg className="burn-disc-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient
              id={REST_GRADIENT_ID}
              gradientUnits="userSpaceOnUse"
              cx="50"
              cy="50"
              r={REST_GRADIENT_R}
            >
              <stop offset={R_IN / REST_GRADIENT_R} stopColor="var(--border)" stopOpacity="0.34" />
              <stop offset={R_OUT / REST_GRADIENT_R} stopColor="var(--border)" stopOpacity="0.14" />
            </radialGradient>
          </defs>

          {/* The stacking ring: the bezel closing the hub, the ring the drive
              clamps, and the mirror band between clamp and program area. */}
          <circle className="burn-disc-bezel" cx="50" cy="50" r={R_BEZEL} fill="none" />
          <circle className="burn-disc-clamp" cx="50" cy="50" r={R_CLAMP} fill="none" />
          <circle className="burn-disc-mirror" cx="50" cy="50" r={R_MIRROR} fill="none" />

          {/* The program area itself, beneath everything. This is what shows
              through the hairlines between wedges — without it the gaps cut
              straight to the black surface and read as damage rather than as
              divisions. */}
          <circle
            className="burn-ring-rest"
            cx="50"
            cy="50"
            r={(R_IN + R_OUT) / 2}
            fill="none"
            strokeWidth={R_OUT - R_IN}
          />

          {/* The lead-in, where CD-TEXT is written. */}
          <circle className="burn-ring-leadin" cx="50" cy="50" r={R_LEADIN} fill="none" />

          <g className={hoveredIndex !== null ? 'burn-ring-arcs has-hover' : 'burn-ring-arcs'}>
            {geometry.slices.map(slice => (
              <path
                key={slice.key}
                className={slice.index === hotIndex ? 'burn-ring-arc is-hot' : 'burn-ring-arc'}
                style={{ fill: slice.color, stroke: slice.color }}
                d={annularSector(R_IN, R_OUT, slice.startAngle, wedgeEnd(slice))}
              />
            ))}
          </g>

          <g className="burn-ring-written">
            {written.map(part => (
              <path key={part.key} style={{ fill: part.color, stroke: part.color }} d={part.d} />
            ))}
          </g>

          {/* Past the disc's edge. The ring is the queue, so the wash names the
              tracks that will not fit rather than restating the arithmetic the
              hub already prints: 'over capacity by 4:12' has never told anyone
              which track to take off. */}
          {overrunAngle !== null && (
            <g className="burn-ring-over">
              <path
                className="burn-ring-overrun"
                d={annularSector(R_IN, R_OUT, overrunAngle, 360)}
              />
              <line
                className="burn-ring-overrun-mark"
                x1={polar(R_IN - OVERRUN_MARK_OVERHANG, overrunAngle)[0]}
                y1={polar(R_IN - OVERRUN_MARK_OVERHANG, overrunAngle)[1]}
                x2={polar(R_OUT + OVERRUN_MARK_OVERHANG, overrunAngle)[0]}
                y2={polar(R_OUT + OVERRUN_MARK_OVERHANG, overrunAngle)[1]}
              />
            </g>
          )}

          {/* The polished edge, outside the program area and under the head. */}
          <circle className="burn-disc-rim-in" cx="50" cy="50" r={R_RIM_IN} fill="none" />
          <circle className="burn-disc-rim" cx="50" cy="50" r={R_RIM} fill="none" />

          {onDisc && (
            <g className="burn-ring-head">
              {/* Three stacked strokes rather than one line under a CSS
                  drop-shadow: filter lengths inside an SVG resolve against
                  user units in some engines and CSS pixels in others, and the
                  glow has to scale with the disc either way. */}
              {HEAD_STROKES.map(({ key, width }) => {
                // `R_IN` exactly, not `R_IN - 1.5`. The program area's inner
                // edge is 22.8 and the lead-in ring sits at 21.5, so an inner
                // end at 21.3 put the head THROUGH that ring — a line visibly
                // crossing the hub's surround. It now stops where the data it
                // is writing starts. The outer end still stands proud.
                const [x1, y1] = polar(R_IN, geometry.progressAngle);
                const [x2, y2] = polar(R_OUT + 1.5, geometry.progressAngle);
                return (
                  <line
                    key={key}
                    className={`burn-ring-head-${key}`}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    strokeWidth={width}
                  />
                );
              })}
            </g>
          )}
        </svg>

        <div className="burn-disc-grooves" />

        {/* The specular highlight, over everything rather than under it. The
            iris is diffraction coming up through the dye, so it belongs below
            the data layer; this is light bouncing off the lacquer, so it
            belongs above one. Putting both underneath made the disc read as
            printed rather than pressed. */}
        <div className="burn-disc-sheen" aria-hidden="true" />
      </div>

      <canvas className="burn-disc-wave" ref={waveCanvas} aria-hidden="true" />
      <canvas className="burn-disc-sparks" ref={sparkCanvas} aria-hidden="true" />

      <div className="burn-disc-hub" ref={hubRef}>
        {/* Both purely decorative, both behind the text and neither able to
            take a pointer. They exist only while the laser is on: a hub that
            pulsed at rest would be claiming a burn that is not happening. */}
        {onDisc && <div className="burn-disc-hub-shock" ref={hubShockRef} aria-hidden="true" />}
        {onDisc && <div className="burn-disc-hub-pulse-ring" ref={hubRingRef} aria-hidden="true" />}
        <div className="burn-disc-hub-content">
          <small>{hub.kicker}</small>
          <strong>{hub.big}</strong>
          <span>{hub.note}</span>
        </div>
      </div>
    </div>
  );
}
