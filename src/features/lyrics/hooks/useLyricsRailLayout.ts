import { useLayoutEffect, useRef } from 'react';

const CLEAR_FRACTION = 0.6;
const CHROME_GAP = 8;

function setStyle(node: HTMLElement, name: string, value: string) {
  if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
}

function observeRail(overlay: HTMLDivElement) {
  const rail = overlay.querySelector<HTMLElement>('.fsr-lyrics-rail');
  if (!rail) return null;
  let activeIndex = -1;
  let root: HTMLElement | null = null;
  let cluster: HTMLElement | null = null;
  let close: HTMLElement | null = null;
  let badge: HTMLElement | null = null;
  let rows: HTMLElement[] = [];
  let frame: number | null = null;
  let disposed = false;
  const observed = new Set<Element>();
  // Observer-driven writes run outside ResizeObserver delivery. Synchronous
  // commit measurement below still positions new/zoomed lyrics before paint.
  const schedule = () => {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; measure(); });
  };
  const resize = new ResizeObserver(schedule);
  const mutation = new MutationObserver(schedule);

  function syncTargets() {
    const nextRoot = overlay.closest<HTMLElement>('.fs-player');
    const nextCluster = nextRoot?.querySelector<HTMLElement>('.fs-cluster') ?? null;
    const nextClose = nextRoot?.querySelector<HTMLElement>('.fs-close') ?? null;
    badge = overlay.parentElement?.querySelector<HTMLElement>('.lyrics-zoom-badge') ?? null;
    if (root !== nextRoot || cluster !== nextCluster || close !== nextClose) {
      mutation.disconnect();
      root = nextRoot;
      cluster = nextCluster;
      close = nextClose;
      for (const node of [root, cluster, close]) {
        if (node) mutation.observe(node, {
          attributes: true,
          attributeFilter: ['style', 'class'],
          childList: node === root,
        });
      }
    }
    rows = Array.from(rail!.children) as HTMLElement[];
    const targets = new Set<Element>([overlay, ...rows]);
    for (const node of [root, cluster, close, badge]) if (node) targets.add(node);
    for (const node of observed) {
      if (!targets.has(node)) { resize.unobserve(node); observed.delete(node); }
    }
    for (const node of targets) {
      if (!observed.has(node)) { resize.observe(node); observed.add(node); }
    }
  }

  function measure() {
    syncTargets();
    const row = rows[Math.max(0, activeIndex)];
    if (!row) return;
    const viewportHeight = root?.clientHeight || window.innerHeight;
    const rootTop = root?.getBoundingClientRect().top ?? 0;
    const closeBox = close?.getBoundingClientRect();
    const clusterBox = cluster?.getBoundingClientRect();
    // Root-relative coordinates also work while the player enters via a
    // translate animation. Reserve the actual close button and info cluster.
    const baseTop = Math.max(viewportHeight * 0.15, closeBox?.height ? closeBox.bottom - rootTop + CHROME_GAP : 0);
    const bottom = Math.min(viewportHeight, clusterBox?.height ? clusterBox.top - rootTop - CHROME_GAP : viewportHeight);
    if (badge && overlay.parentElement) {
      setStyle(overlay.parentElement, '--lyrics-rail-badge-top', `${baseTop}px`);
      setStyle(badge, 'visibility', baseTop + badge.offsetHeight > bottom ? 'hidden' : '');
    }
    const top = baseTop + (badge ? badge.offsetHeight + CHROME_GAP : 0);
    const maxHeight = Math.max(0, Math.min(viewportHeight * 0.6, bottom - top));
    // A small inset absorbs fractional-pixel offsetHeight/offsetTop rounding.
    const rowMax = Math.max(0, maxHeight * CLEAR_FRACTION - 2);
    setStyle(overlay, '--lyrics-rail-top', `${top}px`);
    setStyle(overlay, '--lyrics-rail-row-max', `${rowMax}px`);
    setStyle(overlay, 'visibility', rowMax < 1 ? 'hidden' : '');
    if (rowMax < 1) { setStyle(overlay, 'height', '0px'); return; }
    const rowHeight = row.getBoundingClientRect().height || row.offsetHeight || Math.min(viewportHeight * 0.06, rowMax);
    const height = Math.min(maxHeight, Math.max(viewportHeight * 0.3, (rowHeight + 2) / CLEAR_FRACTION));
    setStyle(overlay, 'height', `${height}px`);
    setStyle(rail!, 'transform', `translateY(${height / 2 - row.offsetTop - rowHeight / 2}px)`);
  }

  window.addEventListener('resize', schedule);
  return {
    overlay,
    update(index: number) { activeIndex = index; measure(); },
    dispose() {
      disposed = true;
      resize.disconnect();
      mutation.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    },
  };
}

/** Keep the active row in the clear centre of the rail's fade mask.
 * Rows retain their legacy 6vh minimum, but can grow for zoom/wrapped layers.
 * Observe row/chrome geometry without rebinding on every active-line render.
 */
export function useLyricsRailLayout(activeIndex: number) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<ReturnType<typeof observeRail>>(null);
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (layoutRef.current?.overlay !== overlay) {
      layoutRef.current?.dispose();
      layoutRef.current = overlay ? observeRail(overlay) : null;
    }
    layoutRef.current?.update(activeIndex);
  });
  useLayoutEffect(() => () => {
    layoutRef.current?.dispose();
    layoutRef.current = null;
  }, []);
  return overlayRef;
}
