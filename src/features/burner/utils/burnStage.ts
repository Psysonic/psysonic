/**
 * What the burner page is *doing*, and the widths it does it in.
 *
 * The page has four stages and they are not the same thing as the job's six
 * phases: the geometry changes once, when the user commits, and then holds
 * still until they clear it. Everything downstream — the disc's scale, which
 * controls are mounted, what the transport button means — is a function of
 * this one value, so it is derived in one place rather than re-tested from
 * `status` and `phase` at every call site.
 *
 * The width constants live here too because CSS and JS both need them and a
 * disagreement between the two is invisible until the running order is clipped
 * off a page that is `overflow: hidden`. `src/styles/components/burner.css`
 * carries the same numbers; change them together.
 */
import {
  burnJobIsActive,
  burnJobIsCommitted,
  type BurnJobStatus,
  type BurnPhase,
} from '@/features/burner/store/burnJobStore';

export type BurnStage = 'building' | 'preparing' | 'committing' | 'settled';

/** The rail's fixed column. */
export const RAIL_W_PX = 216;
/** The one gutter the seam does not draw. */
export const RAIL_GAP_PX = 16;
export const SEAM_W_PX = 14;
/** Below this the disc stops being a showpiece and starts being a smudge. */
export const STAGE_MIN_PX = 300;
export const SIDE_MIN_PX = 320;
export const SIDE_DEFAULT_PX = 420;
export const SIDE_MAX_PX = 760;

/** Rail + stage + seam + side all fit above this. */
export const COLS3_MIN_PX = 940;
/** Stage + seam + side still fit above this; the rail drops to a strip. */
export const COLS2_MIN_PX = 640;

export const KEY_STEP_PX = 16;
export const KEY_STEP_COARSE_PX = 64;

/**
 * Note: these three are documentation, not wiring. The CSS holds the real
 * values; nothing imports these. Keep them in step by hand.
 */
export const DISC_SCALE_BUILDING = 0.85;
export const DISC_SCALE_EXPANDED = 1;

/** The single easing duration; the stylesheet transitions the disc over it. */
export const MORPH_MS = 520;
/** How long an armed abort stays armed before it disarms itself. */
export const ABORT_ARM_MS = 4000;
/** How long the active-row follow stands down after the user scrolls. */
export const SCROLL_SUPPRESS_MS = 6000;

/**
 * A burn that died mid-write must not collapse the page. `settled` covers
 * done, failed and cancelled alike, because all three end with the user
 * reading an outcome and looking at the disc they just made.
 */
export function burnStageFrom(status: BurnJobStatus, phase: BurnPhase | null): BurnStage {
  if (status === 'done' || status === 'failed' || status === 'cancelled') return 'settled';
  if (burnJobIsCommitted(status, phase)) return 'committing';
  if (burnJobIsActive(status)) return 'preparing';
  return 'building';
}

/** Only `building` leaves room for the drive row and the mode switch. */
export function isExpanded(stage: BurnStage): boolean {
  return stage !== 'building';
}

/**
 * Measured on `.burner-split`, never on the window. The app shell is a grid
 * with a 200-220px sidebar and a 310-500px queue panel, so a 1440px window can
 * leave this page only 864px wide — a window media query calls that "wide" and
 * clips the running order.
 */
export function colsFor(splitWidth: number): 1 | 2 | 3 {
  if (splitWidth >= COLS3_MIN_PX) return 3;
  if (splitWidth >= COLS2_MIN_PX) return 2;
  return 1;
}

function clamp(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * How wide the running order is allowed to get without squeezing the stage
 * below `STAGE_MIN_PX`. At one column the seam is hidden and there is nothing
 * to bound, so the stored preference stands.
 */
export function maxSideWidth(splitWidth: number, cols: 1 | 2 | 3): number {
  if (cols === 3) {
    return clamp(SIDE_MIN_PX, splitWidth - RAIL_W_PX - RAIL_GAP_PX - SEAM_W_PX - STAGE_MIN_PX, SIDE_MAX_PX);
  }
  if (cols === 2) {
    return clamp(SIDE_MIN_PX, splitWidth - SEAM_W_PX - STAGE_MIN_PX, SIDE_MAX_PX);
  }
  return SIDE_MAX_PX;
}
