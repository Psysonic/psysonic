import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { blurredCover, peekBlurredCover } from '@/lib/dom/blurredCover';

interface Props {
  explicit: boolean;
}

/**
 * Blurs the cover it sits next to. Place it directly after the cover element,
 * inside the cover's own container: it hides that container's image (CSS on
 * `[data-explicit-veil]`, so there is no sharp first frame) and lays a
 * stretched thumbnail of it over the image's box. Overlays later in the
 * container still paint above it, and clicks reach the container as before.
 * Until the thumbnail is ready — or when the image cannot be read — a plain
 * placeholder covers the box instead.
 */
export default function ExplicitCoverVeil({ explicit }: Props) {
  if (!explicit) return null;
  return <VeilWhenEnabled />;
}

function VeilWhenEnabled() {
  const enabled = useThemeStore(s => s.blurExplicitCovers);
  return enabled ? <Veil /> : null;
}

type Box = { left: number; top: number; width: number; height: number; borderRadius: string };

function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top && a.width === b.width
    && a.height === b.height && a.borderRadius === b.borderRadius;
}

function coverImage(host: HTMLElement): HTMLImageElement | null {
  for (const img of host.querySelectorAll('img')) {
    if (!img.classList.contains('explicit-veil')) return img;
  }
  return null;
}

/** Position of `el` inside `host`'s padding box, independent of transforms. */
function offsetWithin(el: HTMLElement, host: HTMLElement): { left: number; top: number } {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== host) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node === host) return { left, top };
  const hostRect = host.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  return { left: rect.left - hostRect.left - host.clientLeft, top: rect.top - hostRect.top - host.clientTop };
}

function Veil() {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    const host = anchorRef.current?.parentElement;
    if (!host) return;
    host.setAttribute('data-explicit-veil', '');
    const positioned = getComputedStyle(host).position !== 'static';
    if (!positioned) host.style.position = 'relative';

    let cancelled = false;
    let currentSrc = '';

    const measure = () => {
      const img = coverImage(host);
      if (!img) {
        setBox(prev => (prev === null ? prev : null));
        return;
      }
      const { left, top } = offsetWithin(img, host);
      const next: Box = {
        left,
        top,
        width: img.offsetWidth,
        height: img.offsetHeight,
        borderRadius: getComputedStyle(img).borderRadius,
      };
      setBox(prev => (sameBox(prev, next) ? prev : next));
    };

    const syncSource = () => {
      const img = coverImage(host);
      const next = img?.currentSrc || img?.getAttribute('src') || '';
      if (next === currentSrc) return;
      currentSrc = next;
      if (!next) {
        setSrc(null);
        return;
      }
      const known = peekBlurredCover(next);
      if (known !== undefined) {
        setSrc(known);
        return;
      }
      setSrc(null);
      void blurredCover(next).then(value => {
        if (!cancelled && currentSrc === next) setSrc(value);
      });
    };

    const update = () => {
      syncSource();
      measure();
    };
    update();

    const mutations = new MutationObserver(update);
    mutations.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'class'] });
    const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resizes?.observe(host);

    return () => {
      cancelled = true;
      mutations.disconnect();
      resizes?.disconnect();
      host.removeAttribute('data-explicit-veil');
      if (!positioned) host.style.position = '';
    };
  }, []);

  const style: CSSProperties | undefined = box ?? undefined;
  return (
    <span ref={anchorRef} className="explicit-veil-anchor" aria-hidden="true">
      {box && (src
        ? <img className="explicit-veil" src={src} alt="" style={style} />
        : <span className="explicit-veil explicit-veil--placeholder" style={style} />)}
    </span>
  );
}
