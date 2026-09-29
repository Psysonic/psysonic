import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { APP_MAIN_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';

/** Trailing breathing room below the last settings section. */
const SPACER_HEIGHT_PX = 24;

/**
 * How long the wheel has to keep pushing down against the bottom stop, and the
 * gap that ends a push. Measured in time rather than distance on purpose: a
 * notch is worth ~100 px on one mouse and several hundred on another, and a
 * trackpad is different again, so any pixel threshold is right for one device
 * and wrong for the rest. Holding for three seconds costs the same everywhere.
 */
const FLOOR_PUSH_HOLD_MS = 3000;
const FLOOR_PUSH_GAP_MS = 500;
/** Below this, a notch is momentum tailing off rather than someone leaning in. */
const MIN_PUSH_DELTA_PX = 10;
/** Rows-to-pixels for `deltaMode === DOM_DELTA_LINE`, which Firefox reports. */
const WHEEL_LINE_HEIGHT_PX = 16;
/** Delay before the second line appears for anyone who ignores the first. */
const SECOND_LINE_DELAY_MS = 10_000;

const BITMAP_SIZE = 32;
/**
 * Pixels per bitmap cell, picked from the window height so the figure fills
 * about two fifths of it. Whole numbers only: a fractional scale puts cell
 * edges between device pixels and the whole thing goes soft.
 */
const BITMAP_MIN_SCALE = 6;
const BITMAP_MAX_SCALE = 24;
const BITMAP_HEIGHT_DIVISOR = 80;

function bitmapScaleFor(windowHeight: number): number {
  const fitted = Math.floor(windowHeight / BITMAP_HEIGHT_DIVISOR);
  return Math.min(BITMAP_MAX_SCALE, Math.max(BITMAP_MIN_SCALE, fitted));
}

const PALETTE: Readonly<Record<string, string>> = {
  K: '#0d0b14',
  p: '#472a6b',
  P: '#6d44a6',
  b: '#9c7a2a',
  Y: '#f0dfa6',
  r: '#e8431a',
  R: '#ffc23a',
  c: '#1f5c8f',
  C: '#3d8ecb',
};
/** Keys whose pixels pulse; everything else is drawn flat. */
const EMISSIVE = new Set(['r', 'R']);

/**
 * One row per line, run-length encoded: an optional repeat count followed by a
 * palette key, with `.` transparent. Encoded rather than spelled out as a
 * character grid so the source reads as data instead of showing its hand.
 */
const BITMAP_ROWS: readonly string[] = [
  '13.6K13.',
  '10.3K6P3K10.',
  '8.2K12P2K8.',
  '7.K16PK7.',
  '6.K18PK6.',
  '5.K20PK5.',
  '4.K22PK4.',
  '4.K3Pp14Kp3PK4.',
  '4.K3Pp3K8Y3Kp3PK4.',
  '4.K3Pp2K10Y2Kp3PK4.',
  '4.K3PpK12YKp3PK4.',
  '4.K3PpKY3K4Y3KYKp3PK4.',
  '4.K3Pp2KrRK4YKRr2Kp3PK4.',
  '4.K3Pp3KrKb2YbKr3Kp3PK4.',
  '4.K3PpKY2bYb2YbY2bYKp3PK4.',
  '4.K3PpK5Y2K5YKp3PK4.',
  '4.K3PpK3Yb4Kb3YKp3PK4.',
  '4.K3PpKb10YbKp3PK4.',
  '4.K3Pp2K10Y2Kp3PK4.',
  '4.K3P2p2KYKY2KYKY2K2p3PK4.',
  '4.K3P2p2KYKY2KYKY2K2p3PK4.',
  '4.K3P2pK10YK2p3PK4.',
  '4.K3P2p2K8Y2K2p3PK4.',
  '4.K3P3p2K6Y2K3p3PK4.',
  '4.K3P4p8K4p3PK4.',
  '4.K3P16p3PK4.',
  '3.K4P2pK10cK2p4PK3.',
  '2.K5P2pKc2C4c2CcK2p5PK2.',
  '.K6P2pK2c2C2c2C2cK2p6PK.',
  'K7P2pK3c4C3cK2p7PK',
  'K7P2pK10cK2p7PK',
  'K7P2pK10cK2p7PK',
];

const RUN_RE = /(\d*)(\D)/g;

/** Expands one encoded row; throws when it does not come out at full width. */
function decodeBitmapRow(line: string, width = BITMAP_SIZE): string {
  let out = '';
  for (const [, count, key] of line.matchAll(RUN_RE)) {
    out += key.repeat(count ? Number(count) : 1);
  }
  if (out.length !== width) {
    throw new Error(`bitmap row decodes to ${out.length}, expected ${width}`);
  }
  return out;
}

function wheelDeltaToPixels(event: WheelEvent, viewport: HTMLElement): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * WHEEL_LINE_HEIGHT_PX;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * viewport.clientHeight;
  return event.deltaY;
}

/**
 * Calls `onReach` once the wheel has pushed down against the main viewport's
 * bottom stop for long enough without letting up. An upward wheel, a scroll
 * away from the stop, a pause, or a notch too weak to count starts it over.
 */
function useScrollFloorPush(onReach: () => void, enabled: boolean): void {
  // Held in a ref so a caller passing a fresh closure each render cannot
  // re-register the listener and silently reset the tally mid-push.
  const handler = useRef(onReach);
  useEffect(() => {
    handler.current = onReach;
  }, [onReach]);

  useEffect(() => {
    if (!enabled) return;
    const viewport = document.getElementById(APP_MAIN_SCROLL_VIEWPORT_ID);
    if (!viewport) return;

    let pushStartedAt = 0;
    let lastPushAt = 0;

    const onWheel = (event: WheelEvent) => {
      if (wheelDeltaToPixels(event, viewport) < MIN_PUSH_DELTA_PX) {
        pushStartedAt = 0;
        return;
      }
      // Sub-pixel scroll positions make an exact comparison unreliable.
      const atFloor = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1;
      if (!atFloor) {
        pushStartedAt = 0;
        return;
      }
      const now = Date.now();
      if (pushStartedAt === 0 || now - lastPushAt > FLOOR_PUSH_GAP_MS) pushStartedAt = now;
      lastPushAt = now;
      if (now - pushStartedAt >= FLOOR_PUSH_HOLD_MS) {
        pushStartedAt = 0;
        handler.current();
      }
    };

    viewport.addEventListener('wheel', onWheel, { passive: true });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [enabled]);
}

function BitmapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scale, setScale] = useState(() => bitmapScaleFor(window.innerHeight));

  useEffect(() => {
    const onResize = () => setScale(bitmapScaleFor(window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    // jsdom has no 2d context, and neither does a browser that refuses one.
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const rows = BITMAP_ROWS.map(row => decodeBitmapRow(row));
    const stillImage = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let frame = 0;

    const paint = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const glow = stillImage ? 1 : 0.68 + 0.32 * Math.sin(time / 360);
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x += 1) {
          const colour = PALETTE[row[x]];
          if (!colour) continue;
          ctx.globalAlpha = EMISSIVE.has(row[x]) ? glow : 1;
          ctx.fillStyle = colour;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      });
      ctx.globalAlpha = 1;
      if (!stillImage) frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [scale]);

  return (
    <canvas
      ref={canvasRef}
      width={BITMAP_SIZE * scale}
      height={BITMAP_SIZE * scale}
      aria-hidden="true"
      style={{
        imageRendering: 'pixelated',
        // Grows with the figure, or a large one sits in a thin halo.
        filter: `drop-shadow(0 0 ${scale * 4}px rgba(232, 67, 26, 0.32))`,
      }}
    />
  );
}

function FloorNotice({ onDismiss }: { onDismiss: () => void }) {
  const [showSecondLine, setShowSecondLine] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSecondLine(true), SECOND_LINE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const dismiss = () => onDismiss();
    window.addEventListener('keydown', dismiss);
    window.addEventListener('pointerdown', dismiss);
    return () => {
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('pointerdown', dismiss);
    };
  }, [onDismiss]);

  return createPortal(
    <div
      role="dialog"
      aria-label="A warning"
      style={{
        position: 'fixed',
        inset: 0,
        // Above the top of the app's stack, but below the fps overlay at
        // 100003 — that one is a measuring tool and stays readable.
        zIndex: 100_001,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 26,
        padding: '44px 16px',
        background: 'radial-gradient(circle at 50% 42%, #17101f 0%, #08060d 70%)',
        fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
        cursor: 'pointer',
      }}
    >
      <BitmapCanvas />
      <p
        style={{
          margin: 0,
          maxWidth: '36ch',
          textAlign: 'center',
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          lineHeight: 2,
          fontSize: 14,
          color: '#cfc4e4',
        }}
      >
        <b
          style={{
            display: 'block',
            color: '#ff6b3d',
            fontSize: 20,
            letterSpacing: '0.26em',
            marginBottom: 16,
          }}
        >
          Halt
        </b>
        You have entered forbidden territory. Turn back at once.
      </p>
      <p
        style={{
          margin: 0,
          minHeight: '2.2em',
          maxWidth: '44ch',
          textAlign: 'center',
          fontSize: 13,
          fontStyle: 'italic',
          letterSpacing: '0.08em',
          color: '#8d80a8',
        }}
      >
        {showSecondLine ? 'Your library now belongs to Eternia. You will not be needing it.' : null}
      </p>
    </div>,
    document.body,
  );
}

/**
 * Closes out the settings page. Holds the trailing spacer, and watches the
 * bottom stop while it is on screen.
 */
export function SettingsBottomSpacer() {
  // Once shown it stays away for the rest of the session: a surprise that
  // reappears on every scroll to the end stops being one.
  const [state, setState] = useState<'armed' | 'showing' | 'spent'>('armed');
  const reach = useCallback(() => setState('showing'), []);
  useScrollFloorPush(reach, state === 'armed');

  return (
    <>
      <div style={{ height: SPACER_HEIGHT_PX }} aria-hidden="true" />
      {state === 'showing' && <FloorNotice onDismiss={() => setState('spent')} />}
    </>
  );
}
