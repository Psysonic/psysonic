import { useEffect, useRef } from 'react';

function isEditableKeyTarget(e: KeyboardEvent): boolean {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Escape drops a tracklist's multi-selection wherever focus sits, whichever
 * click mode is set. Listens in the capture phase so it runs before the list's
 * own cursor handler, which then drops the cursor on the same key press. An open
 * context menu keeps Escape to itself: closing it must not throw away the
 * selection it was opened for.
 */
export function useEscapeClearsSelection(active: boolean, clear: () => void): void {
  const clearRef = useRef(clear);
  // React Compiler refs rule: ref kept in sync with the latest value for use in an event listener; not render data.
  // eslint-disable-next-line react-hooks/refs
  clearRef.current = clear;

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditableKeyTarget(e)) return;
      if (document.querySelector('.context-menu')) return;
      clearRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active]);
}
