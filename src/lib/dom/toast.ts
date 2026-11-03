/**
 * Small toast notices drawn straight into the DOM, outside React, so any
 * module can raise one. Colours come from the theme's CSS variables; several
 * notices at once pile up from the bottom, the newest lowest.
 */

export type ToastVariant = 'error' | 'info' | 'warning' | 'success';

interface VariantLook {
  glyph: string;
  glyphSize: string;
  color: string;
  /** Faint outline in the variant colour, for the notices that need attention. */
  ring: boolean;
}

const LOOKS: Record<ToastVariant, VariantLook> = {
  error: { glyph: '✕', glyphSize: '11px', color: 'var(--danger)', ring: true },
  warning: { glyph: '!', glyphSize: '11px', color: 'var(--warning, #f59e0b)', ring: true },
  success: { glyph: '✓', glyphSize: '10px', color: 'var(--positive, #10b981)', ring: false },
  info: { glyph: 'ℹ', glyphSize: '11px', color: 'var(--accent)', ring: false },
};

/** Distance of the lowest notice from the window bottom, clear of the player bar. */
const STACK_BASE_PX = 100;
const STACK_SPACING_PX = 8;

/** Notices on screen, oldest first. */
const onScreen: HTMLElement[] = [];

function placeStack(): void {
  let offset = STACK_BASE_PX;
  for (let i = onScreen.length - 1; i >= 0; i--) {
    const el = onScreen[i];
    el.style.bottom = `${offset}px`;
    offset += el.offsetHeight + STACK_SPACING_PX;
  }
}

function dismiss(el: HTMLElement): void {
  const at = onScreen.indexOf(el);
  if (at !== -1) onScreen.splice(at, 1);
  el.remove();
  placeStack();
}

function buildGlyph(look: VariantLook): HTMLElement {
  const glyph = document.createElement('span');
  glyph.textContent = look.glyph;
  Object.assign(glyph.style, {
    flexShrink: '0',
    width: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    background: look.color,
    color: 'var(--bg-app)',
    fontSize: look.glyphSize,
    fontWeight: '700',
    lineHeight: '1',
  });
  return glyph;
}

function buildNotice(text: string, look: VariantLook): HTMLElement {
  const notice = document.createElement('div');
  notice.className = 'psysonic-toast';
  const shadow = '0 4px 24px rgba(0,0,0,0.45)';
  Object.assign(notice.style, {
    position: 'fixed',
    left: '50%',
    bottom: `${STACK_BASE_PX}px`,
    transform: 'translateX(-50%)',
    zIndex: '999999',
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: 'max-content',
    maxWidth: '480px',
    padding: '10px 16px',
    borderRadius: '8px',
    border: `1px solid ${look.color}`,
    borderLeft: `3px solid ${look.color}`,
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    fontSize: '13.5px',
    fontWeight: '500',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    boxShadow: look.ring
      ? `${shadow}, 0 0 0 1px color-mix(in srgb, ${look.color} 20%, transparent)`
      : shadow,
    transition: 'bottom 150ms ease',
  });

  const label = document.createElement('span');
  label.textContent = text;
  Object.assign(label.style, { flex: '1', minWidth: '0' });

  notice.append(buildGlyph(look), label);
  return notice;
}

type Politeness = 'polite' | 'assertive';

/** Long enough for a screen reader to notice the cleared region before the new text lands. */
const ANNOUNCE_DELAY_MS = 100;
const liveRegions: Partial<Record<Politeness, HTMLElement>> = {};

/**
 * Screen readers hear toasts through two live regions that stay in the
 * document — polite for notices, assertive for errors. Text written into a
 * region that already exists is announced reliably; a freshly inserted toast is
 * not, which is why toasts used to go unheard.
 */
function liveRegion(politeness: Politeness): HTMLElement {
  const existing = liveRegions[politeness];
  if (existing?.isConnected) return existing;
  const region = document.createElement('div');
  region.className = 'visually-hidden';
  region.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status');
  region.setAttribute('aria-live', politeness);
  region.setAttribute('aria-atomic', 'true');
  region.dataset.toastLive = politeness;
  document.body.appendChild(region);
  liveRegions[politeness] = region;
  return region;
}

function announce(text: string, politeness: Politeness): void {
  const region = liveRegion(politeness);
  // Cleared first, so the same message shown twice is announced twice.
  region.textContent = '';
  window.setTimeout(() => { region.textContent = text; }, ANNOUNCE_DELAY_MS);
}

export function showToast(text: string, durationMs = 4000, variant: ToastVariant = 'info'): void {
  const notice = buildNotice(text, LOOKS[variant]);
  // The live region speaks for it; hiding the visual copy keeps it from being read twice.
  notice.setAttribute('aria-hidden', 'true');
  document.body.appendChild(notice);
  onScreen.push(notice);
  placeStack();
  announce(text, variant === 'error' ? 'assertive' : 'polite');

  setTimeout(() => dismiss(notice), durationMs);
}
