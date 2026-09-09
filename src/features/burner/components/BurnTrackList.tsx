import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical, X, Download } from 'lucide-react';
import { useDragSource } from '@/lib/dnd/DragDropContext';
import { useListReorderDnd } from '@/lib/hooks/useListReorderDnd';
import type { ListReorderDropTarget } from '@/lib/util/listReorder';
import { formatDuration, formatMsf, type DiscArc } from '@/features/burner/utils/capacity';
import { arcColor } from '@/features/burner/utils/arcColor';

/** Payload discriminator for this list's drag source. */
const REORDER_TYPE = 'burn_track_reorder';

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
  /** Tracks before this index are already on the disc. */
  writtenBefore: number;
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
 * drag from the grip, and keyboard users get the same move via Alt+Arrow.
 */
export default function BurnTrackList({
  arcs,
  hoveredIndex,
  onHoverChange,
  onRemove,
  onMove,
  onReorder,
  activeIndex,
  writtenBefore,
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

  if (arcs.length === 0) {
    return (
      <div className="burner-empty">
        <p>{t('burner.emptyTitle')}</p>
        <p className="burner-empty-hint">{t('burner.emptyHint')}</p>
        <p className="burner-empty-hint">{t('burner.fetchNote')}</p>
      </div>
    );
  }

  return (
    <div className="burner-rows" role="list" ref={setContainer} onMouseMove={onMouseMove}>
      {arcs.map((arc, index) => {
        const willDownload = arc.localPath === null;
        const edge = isDragging ? dropEdge(arc.key) : null;
        return (
          <div
            key={arc.key}
            role="listitem"
            data-reorder-id={arc.key}
            className={[
              'burner-row',
              hoveredIndex === index ? 'is-hot' : '',
              index < writtenBefore ? 'is-written' : '',
              activeIndex === index ? 'is-active' : '',
              edge === 'before' ? 'is-drop-before' : '',
              edge === 'after' ? 'is-drop-after' : '',
            ].filter(Boolean).join(' ')}
            onMouseEnter={() => onHoverChange(index)}
            onMouseLeave={() => onHoverChange(null)}
            onKeyDown={event => {
              if (disabled || !event.altKey) return;
              if (event.key === 'ArrowUp' && index > 0) {
                event.preventDefault();
                onMove(index, index - 1);
              } else if (event.key === 'ArrowDown' && index < arcs.length - 1) {
                event.preventDefault();
                onMove(index, index + 1);
              }
            }}
            tabIndex={0}
          >
            <RowGrip id={arc.key} label={arc.title} disabled={disabled} />
            <span className="burner-row-n">{arc.number}</span>
            <span
              className="burner-row-chip"
              style={{ background: arcColor(index) }}
              aria-hidden="true"
            />
            <span className="burner-row-title">{arc.title}</span>
            <span className="burner-row-artist">{arc.artist}</span>
            <span
              className={`burner-row-fetch${willDownload ? ' is-pending' : ''}`}
              title={willDownload ? t('burner.trackWillDownloadHint') : undefined}
            >
              {willDownload && <Download size={11} aria-hidden="true" />}
            </span>
            <span className="burner-row-msf">{formatMsf(arc.startSector)}</span>
            <span className="burner-row-dur">{formatDuration(arc.durationSec)}</span>
            <button
              type="button"
              className="burner-row-remove"
              onClick={() => onRemove(arc.key)}
              disabled={disabled}
              aria-label={t('burner.removeTrack', { title: arc.title })}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
