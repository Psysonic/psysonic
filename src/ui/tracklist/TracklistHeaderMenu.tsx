import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from 'i18next';
import { ArrowLeft, ArrowRight, Check, MoveHorizontal, RotateCcw } from 'lucide-react';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { columnLabelKey } from '@/ui/tracklist/columnLabel';

export interface TracklistMenuConfig {
  allColumns: readonly ColDef[];
  colVisible: Set<string>;
  toggleColumn: (key: string) => void;
  resetColumns: () => void;
  onFitAll: () => void;
}

interface Props extends TracklistMenuConfig {
  /** Where it opened: pointer position, or the bottom-left of a focused header cell. */
  x: number;
  y: number;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onClose: () => void;
  t: TFunction;
}

const MARGIN = 8;

/**
 * Right-click menu of a track-table header: which columns to show, moving the
 * column it was opened on, fitting every column to its content, and going
 * back to the defaults. A real menu: focus starts on the first entry, the
 * arrow keys move between entries, Escape closes.
 */
export function TracklistHeaderMenu({
  allColumns, colVisible, toggleColumn, resetColumns, onFitAll,
  x, y, onMoveLeft, onMoveRight, onClose, t,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  // Where the focus was before the menu took it; it goes back there on close.
  const returnFocus = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menuEl = ref.current;
    return () => {
      const back = returnFocus.current;
      const active = document.activeElement;
      // Only when the focus is still in the closing menu (or nowhere): a click
      // elsewhere that closed it keeps its own focus.
      if (back?.isConnected && (!active || active === document.body || menuEl?.contains(active))) {
        back.focus({ preventScroll: true });
      }
    };
  }, []);

  // Keep the whole menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 320;
    setPos({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - w - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - h - MARGIN)),
    });
    el?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === ' ') {
      // Space toggles the focused entry here, never the app's play/pause.
      e.preventDefault();
      e.stopPropagation();
      if (e.target instanceof HTMLElement && e.target.matches('[role^="menuitem"]')) e.target.click();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = at <= 0 ? items.length - 1 : at - 1;
    items[next].focus();
  };

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      className="tracklist-col-picker-menu tl-header-menu"
      role="menu"
      aria-label={t('albumDetail.columns')}
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 10050 }}
      onKeyDown={onMenuKeyDown}
      // Portalled, but React bubbles its events to the header, which would
      // reopen the menu there — without the column it was opened on.
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="tracklist-col-picker-label">{t('albumDetail.columns')}</div>
      {allColumns.filter(c => !c.required).map(c => {
        const label = c.i18nKey ? t(columnLabelKey(c.i18nKey)) : c.key;
        const isOn = colVisible.has(c.key);
        return (
          <button
            key={c.key}
            type="button"
            role="menuitemcheckbox"
            aria-checked={isOn}
            tabIndex={-1}
            className={`tracklist-col-picker-item${isOn ? ' active' : ''}`}
            onClick={() => toggleColumn(c.key)}
          >
            <span className="tracklist-col-picker-check">{isOn && <Check size={13} />}</span>
            {label}
          </button>
        );
      })}
      <div className="tracklist-col-picker-divider" role="separator" />
      {onMoveLeft && (
        <button type="button" role="menuitem" tabIndex={-1} className="tracklist-col-picker-reset" onClick={act(onMoveLeft)}>
          <ArrowLeft size={13} />
          {t('albumDetail.moveColumnLeft')}
        </button>
      )}
      {onMoveRight && (
        <button type="button" role="menuitem" tabIndex={-1} className="tracklist-col-picker-reset" onClick={act(onMoveRight)}>
          <ArrowRight size={13} />
          {t('albumDetail.moveColumnRight')}
        </button>
      )}
      <button type="button" role="menuitem" tabIndex={-1} className="tracklist-col-picker-reset" onClick={act(onFitAll)}>
        <MoveHorizontal size={13} />
        {t('albumDetail.fitAllColumns')}
      </button>
      <button type="button" role="menuitem" tabIndex={-1} className="tracklist-col-picker-reset" onClick={act(resetColumns)}>
        <RotateCcw size={13} />
        {t('albumDetail.resetColumns')}
      </button>
    </div>,
    document.body,
  );
}
