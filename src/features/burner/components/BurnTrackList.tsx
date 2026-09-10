import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical, X, Download } from 'lucide-react';
import { useDragSource } from '@/lib/dnd/DragDropContext';
import { useListReorderDnd } from '@/lib/hooks/useListReorderDnd';
import type { ListReorderDropTarget } from '@/lib/util/listReorder';
import { formatDuration, formatMsf, type DiscArc } from '@/features/burner/utils/capacity';
import type { BurnPhase } from '@/features/burner/store/burnJobStore';
import { SCROLL_SUPPRESS_MS, type BurnStage } from '@/features/burner/utils/burnStage';
import { useBurnListAutoscroll } from '@/features/burner/hooks/useBurnListAutoscroll';
import { arcColor } from '@/features/burner/utils/arcColor';

/** Payload discriminator for this list's drag source. */
const REORDER_TYPE = 'burn_track_reorder';

/** How long a smooth `scrollIntoView` keeps emitting scroll events for. */
const SMOOTH_SCROLL_MS = 700;

export interface BurnTrackListProps {
  arcs: DiscArc[];
  hoveredIndex: number | null;
  onHoverChange: (index: number | null) => void;
  onRemove: (key: string) => void;
  /** Keyboard reorder (Alt+Arrow), by position. */
  onMove: (fromIndex: number, toIndex: number) => void;
  /** Drag reorder, resolved by stable key. */
  onReorder: (draggedKey: string, target: ListReorderDropTarget) => void;
  /** Index currently being written, so the row can show it. */
  activeIndex: number | null;
  /** What is happening to the active row, so it never claims the wrong thing. */
  activePhase: BurnPhase | null;
  /** Tracks before this index are already on the disc. */
  writtenBefore: number;
  /** What the page is doing, which decides whether the order is still editable. */
  stage: BurnStage;
  /** First track that runs past the end of the disc, or null when it all fits. */
  overrunFrom: number | null;
  /** The scroller around this list, for autoscroll and for following the head. */
  viewportRef: React.RefObject<HTMLDivElement | null>;
  disabled: boolean;
}

/**
 * Drag handle.
 *
 * The app does not use native HTML5 drag: `DragDropContext` runs its own
 * mouse-driven drag so ghosts and drop targets behave identically across the
 * sidebar, queue and customizers — the shared grips even set
 * `-webkit-user-drag: none` to keep the native one out of the way. A
 * `draggable` attribute here never fires, which is exactly what it did.
 */
function RowGrip({ id, label, disabled }: { id: string; label: string; disabled: boolean }) {
  const { onMouseDown } = useDragSource(() => ({
    data: JSON.stringify({ type: REORDER_TYPE, id }),
    label,
  }));
  return (
    <span
      className="burner-row-grip"
      onMouseDown={disabled ? undefined : onMouseDown}
      onClick={event => event.stopPropagation()}
      aria-hidden="true"
    >
      <GripVertical size={13} />
    </span>
  );
}

/**
 * The running order, paired with the ring.
 *
 * One line per track. A disc holds up to 99 and the job of this screen is
 * judging the order and the runtime at a glance; two-line rows halved how much
 * of the disc you could see at once.
 *
 * Reordering is the point of this list — the order *is* the disc — so rows
 * drag from the grip, and keyboard users get the same move via Alt+Arrow and
 * Alt+Home/End. Every one of those moves is announced: the keyboard reorder
 * used to change the order silently, which for a screen reader made it
 * indistinguishable from nothing happening.
 *
 * Once a job starts the order is no longer editable — from `preparing`, not
 * from the first written sector, because the job snapshots its track list at
 * the start and anything edited after that describes a disc that is not being
 * made. The grip and the remove button give way to empty cells rather than
 * being disabled in place: a control that cannot be re-enabled for the rest of
 * the job is just a dead tab stop.
 * The cells themselves stay, because the row is a grid and dropping two
 * children shifted every later one a column left — which collapsed the titles
 * to a single letter the moment a burn began.
 */
export default function BurnTrackList({
  arcs,
  hoveredIndex,
  onHoverChange,
  onRemove,
  onMove,
  onReorder,
  activeIndex,
  activePhase,
  writtenBefore,
  stage,
  overrunFrom,
  viewportRef,
  disabled,
}: BurnTrackListProps) {
  const { t } = useTranslation();

  const apply = useCallback(
    (draggedId: string, target: ListReorderDropTarget) => {
      if (disabled) return;
      onReorder(draggedId, target);
    },
    [disabled, onReorder],
  );

  const { isDragging, setContainer, onMouseMove, dropEdge } = useListReorderDnd({
    type: REORDER_TYPE,
    apply,
  });

  useBurnListAutoscroll(viewportRef, isDragging);

  // The order is fixed the moment a job starts, not the moment the laser
  // comes on: `preparing` means the job has already taken its track list and
  // is fetching and rendering it, so a removal or a reorder here changed the
  // list on screen and nothing the drive was about to write. Only `building`
  // is still the user's to edit.
  const editable = stage === 'building';

  // Roving tabindex: the list is one tab stop, and the arrows walk it. Ninety-
  // nine individually focusable rows is ninety-nine presses to get past.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  /** Announced after a reorder or a removal, since neither is visible to a reader. */
  const [announcement, setAnnouncement] = useState('');

  const focusRowAt = useCallback((index: number) => {
    const container = rowsRef.current;
    if (!container) return;
    const row = container.querySelectorAll<HTMLElement>('[data-reorder-id]')[index];
    row?.focus();
  }, []);

  const move = useCallback(
    (from: number, to: number) => {
      if (!editable || disabled || to === from || to < 0 || to >= arcs.length) return;
      onMove(from, to);
      setAnnouncement(t('burner.movedTo', {
        title: arcs[from].title,
        position: to + 1,
        total: arcs.length,
      }));
      // The row travels with the track, so focus has to follow it there.
      requestAnimationFrame(() => focusRowAt(to));
    },
    [editable, disabled, arcs, onMove, t, focusRowAt],
  );

  // ── Following the write head ──────────────────────────────────────────
  // A burn walks the whole list, and on a long queue the row being written
  // scrolls out of sight. It follows — but never while the user is reading
  // somewhere else, which is what the suppression window is for.
  const lastUserScrollAt = useRef(0);
  // A window, not a one-shot flag. A smooth `scrollIntoView` emits scroll
  // events for the whole of its animation: the first cleared the flag and
  // every one after it was recorded as the user scrolling, which armed the
  // six-second suppression below. Each successful follow therefore switched
  // following off until well after the next track had started, so the feature
  // this plumbing exists for ran roughly once a minute.
  const programmaticUntil = useRef(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const noteScroll = () => {
      if (performance.now() < programmaticUntil.current) return;
      lastUserScrollAt.current = performance.now();
    };
    viewport.addEventListener('scroll', noteScroll, { passive: true });
    viewport.addEventListener('wheel', noteScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', noteScroll);
      viewport.removeEventListener('wheel', noteScroll);
    };
  }, [viewportRef]);

  useEffect(() => {
    if (activeIndex === null) return;
    if (performance.now() - lastUserScrollAt.current < SCROLL_SUPPRESS_MS) return;
    const container = rowsRef.current;
    const row = container?.querySelectorAll<HTMLElement>('[data-reorder-id]')[activeIndex];
    if (!row) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // Long enough to cover a smooth scroll's tail; an instant one lands in a
    // single event and simply leaves the window unused.
    programmaticUntil.current = performance.now() + (reduced ? 0 : SMOOTH_SCROLL_MS);
    row.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [activeIndex]);

  if (arcs.length === 0) {
    return (
      <div className="burner-empty">
        <p>{t('burner.emptyTitle')}</p>
        <p className="burner-empty-hint">{t('burner.emptyHint')}</p>
        <p className="burner-empty-hint">{t('burner.fetchNote')}</p>
      </div>
    );
  }

  const focusIndex = focusedKey === null
    ? 0
    : Math.max(0, arcs.findIndex(arc => arc.key === focusedKey));

  return (
    <>
      <div
        className="burner-rows"
        role="list"
        ref={node => {
          rowsRef.current = node;
          setContainer(node);
        }}
        onMouseMove={onMouseMove}
      >
        {arcs.map((arc, index) => {
          const willDownload = arc.localPath === null;
          const edge = isDragging ? dropEdge(arc.key) : null;
          const written = index < writtenBefore;
          return (
            <div
              key={arc.key}
              role="listitem"
              data-reorder-id={arc.key}
              // The wedge colour reaches CSS as a property rather than a swatch
              // element: the row's spine is drawn from it, so a whole element
              // existed only to be four pixels wide.
              //
              // It comes from `arcColor`, the same function the ring uses, so
              // the two cannot disagree. It was briefly a `var(--burn-arc-N)`
              // token that nothing defined, which made every row fall back to
              // the accent — a six-colour ring beside a single-colour list.
              style={{ ['--row-color' as string]: arcColor(index) }}
              className={[
                'burner-row',
                hoveredIndex === index ? 'is-hot' : '',
                written ? 'is-written' : '',
                activeIndex === index ? 'is-active' : '',
                overrunFrom !== null && index >= overrunFrom ? 'burner-row-overrun' : '',
                edge === 'before' ? 'is-drop-before' : '',
                edge === 'after' ? 'is-drop-after' : '',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => onHoverChange(index)}
              onMouseLeave={() => onHoverChange(null)}
              onFocus={() => setFocusedKey(arc.key)}
              onKeyDown={event => {
                if (event.altKey) {
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    move(index, index - 1);
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    move(index, index + 1);
                  } else if (event.key === 'Home') {
                    event.preventDefault();
                    move(index, 0);
                  } else if (event.key === 'End') {
                    event.preventDefault();
                    move(index, arcs.length - 1);
                  }
                  return;
                }
                // Plain arrows walk the list without reordering it.
                if (event.key === 'ArrowUp' && index > 0) {
                  event.preventDefault();
                  focusRowAt(index - 1);
                } else if (event.key === 'ArrowDown' && index < arcs.length - 1) {
                  event.preventDefault();
                  focusRowAt(index + 1);
                }
              }}
              tabIndex={index === focusIndex ? 0 : -1}
              aria-current={activeIndex === index ? 'step' : undefined}
            >
              {/* The cell stays even when the control goes. Omitting the
                  element outright shifted every later cell one column left,
                  which is what collapsed the titles to a single letter the
                  moment a burn started. */}
              {editable
                ? <RowGrip id={arc.key} label={arc.title} disabled={disabled} />
                : <span className="burner-row-grip is-locked" aria-hidden="true" />}
              <span className="burner-row-n">{arc.number}</span>
              <span className="burner-row-title">{arc.title}</span>
              <span className="burner-row-artist">{arc.artist}</span>
              {activeIndex === index && activePhase ? (
                <span className="burner-row-state">{t(`burner.phase.${activePhase}`)}</span>
              ) : written ? (
                <span className="burner-row-state" aria-label={t('burner.rowWritten')}>{'✓'}</span>
              ) : (
                <span className="burner-row-dur">{formatDuration(arc.durationSec)}</span>
              )}
              <span className="burner-row-msf">{formatMsf(arc.startSector)}</span>
              <span
                className={`burner-row-fetch${willDownload ? ' is-pending' : ''}`}
                title={willDownload ? t('burner.trackWillDownloadHint') : undefined}
              >
                {willDownload && <Download size={11} aria-hidden="true" />}
              </span>
              {!editable && <span className="burner-row-remove is-locked" aria-hidden="true" />}
              {editable && (
                <button
                  type="button"
                  className="burner-row-remove"
                  onClick={() => {
                    setAnnouncement(t('burner.removedAnnounce', { title: arc.title }));
                    onRemove(arc.key);
                  }}
                  disabled={disabled}
                  tabIndex={-1}
                  aria-label={t('burner.removeTrack', { title: arc.title })}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Reordering with Alt+Arrow announced nothing at all, so a keyboard user
          moved a track and heard silence. `.visually-hidden` is the app's
          shared off-screen utility; this used to carry a `.burner-live` rule
          that duplicated it declaration for declaration. */}
      <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
    </>
  );
}
