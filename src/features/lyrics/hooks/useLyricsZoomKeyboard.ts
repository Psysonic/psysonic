import { useCallback, useRef } from 'react';
import { lyricsZoomAction } from '@/lib/media/lyricsAppearance';
import { applyLyricsZoom } from './useLyricsAppearance';

const FULLSCREEN_HOST = '.fs-player, .fsp, .fsp2-player';
interface Scope { node: HTMLDivElement; fullscreen: boolean; hovered: boolean }
const scopes = new Set<Scope>();
const CLIPPING_OVERFLOW = new Set(['hidden', 'clip', 'auto', 'scroll', 'overlay']);

function visible(node: HTMLElement, requireLayoutArea = false): boolean {
  if (!node.isConnected) return false;
  const rect = requireLayoutArea ? node.getBoundingClientRect() : null;
  let left = Math.max(0, rect?.left ?? 0);
  let right = Math.min(window.innerWidth, rect?.right ?? 0);
  let top = Math.max(0, rect?.top ?? 0);
  let bottom = Math.min(window.innerHeight, rect?.bottom ?? 0);
  if (requireLayoutArea && (right <= left || bottom <= top)) return false;
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    if (parent.hidden || parent.inert || parent.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (!requireLayoutArea || parent === node) continue;
    const clipX = CLIPPING_OVERFLOW.has(style.overflowX || style.overflow);
    const clipY = CLIPPING_OVERFLOW.has(style.overflowY || style.overflow);
    if (!clipX && !clipY) continue;
    const box = parent.getBoundingClientRect();
    // Intersect the actual scrollport/padding box, not the positive-width
    // child of a collapsed sidebar. Account for transformed ancestors too.
    if (clipX) {
      const scale = parent.offsetWidth ? box.width / parent.offsetWidth : 1;
      const edge = box.left + parent.clientLeft * scale;
      left = Math.max(left, edge);
      right = Math.min(right, edge + parent.clientWidth * scale);
    }
    if (clipY) {
      const scale = parent.offsetHeight ? box.height / parent.offsetHeight : 1;
      const edge = box.top + parent.clientTop * scale;
      top = Math.max(top, edge);
      bottom = Math.min(bottom, edge + parent.clientHeight * scale);
    }
    if (right <= left || bottom <= top) return false;
  }
  return true;
}

// One bubbling listener, irrespective of how many panels/renderers are mounted.
// Other controls get first refusal; no OS/global shortcut registry is involved.
function onKeyDown(event: KeyboardEvent) {
  const action = lyricsZoomAction(event);
  if (!action) return;
  const target = event.target instanceof Element ? event.target : document.activeElement;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  // Geometry is read only for recognized zoom keys, never per frame or for
  // ordinary keydown. Reopening a mounted sidebar restores eligibility.
  const available = [...scopes].filter(scope => visible(scope.node, true));
  const fullscreen = available.slice().reverse().find(scope => scope.fullscreen);
  const owner = fullscreen ?? available.find(scope => target && scope.node.contains(target)) ?? available.find(scope => scope.hovered);
  if (!owner) return;
  const host = owner.fullscreen ? owner.node.closest(FULLSCREEN_HOST) ?? owner.node : owner.node;
  // A lightbox/modal owns its own zoom keys, even when focus has not moved yet.
  if ([...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog[open]')]
    .some(dialog => dialog !== host && !dialog.contains(owner.node) && visible(dialog))) return;
  event.preventDefault(); // Also at a bound, or reset at 100%: never zoom the webview.
  applyLyricsZoom(action);
}

/** Register the whole surface (including its toolbar), not the scrolling text.
 * Callback refs handle loading/style switches and StrictMode detach/reattach.
 */
export function useLyricsZoomKeyboard(fullscreen = false) {
  const detach = useRef<(() => void) | null>(null);
  return useCallback((node: HTMLDivElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!node) return;
    const scope: Scope = { node, fullscreen, hovered: false };
    const enter = () => { scope.hovered = true; };
    const leave = () => { scope.hovered = false; };
    if (!scopes.size) window.addEventListener('keydown', onKeyDown);
    scopes.add(scope);
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    detach.current = () => {
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
      scopes.delete(scope);
      if (!scopes.size) window.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreen]);
}
