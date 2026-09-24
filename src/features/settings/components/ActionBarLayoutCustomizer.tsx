import { useCallback, useRef } from 'react';
import { GripVertical, type LucideIcon } from 'lucide-react';
import { useListReorderDnd } from '@/lib/hooks/useListReorderDnd';
import { applyListReorderById, type ListReorderDropTarget } from '@/lib/util/listReorder';
import type { LayoutItem } from '@/lib/util/layoutItems';
import { ReorderGripHandle } from '@/features/settings/components/ReorderGripHandle';

interface Props<Id extends string> {
  items: LayoutItem<Id>[];
  icons: Record<Id, LucideIcon>;
  labels: Record<Id, string>;
  reorderType: string;
  onReorder: (items: LayoutItem<Id>[]) => void;
  onToggle: (id: Id) => void;
  /** Ids that are only toggled, not dragged (listed below the reorderable rows). */
  fixedIds?: readonly Id[];
}

/**
 * Drag-to-reorder list with a visibility toggle per row, for the page action
 * bars under Personalisation (album and playlist detail headers).
 */
export function ActionBarLayoutCustomizer<Id extends string>({
  items, icons, labels, reorderType, onReorder, onToggle, fixedIds = [],
}: Props<Id>) {
  const itemsRef = useRef(items);
  // React Compiler refs rule: ref kept in sync with the latest value for use in handlers; not render data.
  // eslint-disable-next-line react-hooks/refs
  itemsRef.current = items;

  const apply = useCallback((draggedId: string, target: ListReorderDropTarget) => {
    const next = applyListReorderById(itemsRef.current, draggedId, target);
    if (next) onReorder(next);
  }, [onReorder]);

  const { isDragging, setContainer, onMouseMove, dropEdge } = useListReorderDnd({ type: reorderType, apply });

  const renderRow = (item: LayoutItem<Id>, draggable: boolean) => {
    const Icon: LucideIcon = icons[item.id];
    const label = labels[item.id];
    const edge = draggable && isDragging ? dropEdge(item.id) : null;
    return (
      <div
        key={item.id}
        data-reorder-id={draggable ? item.id : undefined}
        className="sidebar-customizer-row"
        style={{
          borderTop:    edge === 'before' ? '2px solid var(--accent)' : undefined,
          borderBottom: edge === 'after'  ? '2px solid var(--accent)' : undefined,
        }}
      >
        {draggable
          ? <ReorderGripHandle id={item.id} type={reorderType} label={label} />
          : (
            // Same footprint as the grip so the icon column lines up with the draggable rows.
            <span className="sidebar-customizer-grip" aria-hidden="true" style={{ visibility: 'hidden' }}>
              <GripVertical size={16} />
            </span>
          )}
        <Icon size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 14 }}>{label}</span>
        <label className="toggle-switch" aria-label={label}>
          <input type="checkbox" checked={item.visible} onChange={() => onToggle(item.id)} />
          <span className="toggle-track" />
        </label>
      </div>
    );
  };

  const fixed = new Set<string>(fixedIds);
  return (
    <div style={{ padding: '4px 0' }}>
      <div ref={setContainer} onMouseMove={onMouseMove}>
        {items.filter(it => !fixed.has(it.id)).map(it => renderRow(it, true))}
      </div>
      {items.filter(it => fixed.has(it.id)).map(it => renderRow(it, false))}
    </div>
  );
}
