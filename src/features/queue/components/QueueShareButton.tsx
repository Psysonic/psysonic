import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2 } from 'lucide-react';
import type { ServerChoiceOption } from '@/ui/ServerChoiceList';
import { ServerChoiceWarning } from '@/ui/ServerChoiceList';

interface Props {
  label: string;
  open: boolean;
  options: ServerChoiceOption[];
  initialServerId: string;
  onTrigger: () => void;
  onClose: () => void;
  onShare: (serverId: string) => Promise<void>;
}

export function QueueShareButton({
  label,
  open,
  options,
  initialServerId,
  onTrigger,
  onClose,
  onShare,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const triggerRect = trigger.getBoundingClientRect();
      const panelWidth = panel.offsetWidth;
      const margin = 8;
      const idealLeft = triggerRect.left + triggerRect.width / 2 - panelWidth / 2;
      const left = Math.max(margin, Math.min(idealLeft, window.innerWidth - panelWidth - margin));
      setPosition({ top: triggerRect.bottom + 8, left, ready: true });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, options]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`queue-round-btn${open ? ' active' : ''}`}
        onClick={onTrigger}
        data-tooltip={open ? undefined : label}
        aria-label={label}
        aria-haspopup={options.length > 1 ? 'menu' : undefined}
        aria-expanded={options.length > 1 ? open : undefined}
      >
        <Share2 size={13} />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="nav-library-dropdown-panel queue-share-popover"
          role="menu"
          aria-label={label}
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            visibility: position.ready ? 'visible' : 'hidden',
          }}
        >
          {options.map(server => (
            <button
              key={server.id}
              type="button"
              role="menuitem"
              className="queue-share-server-item"
              aria-label={server.warning ? `${server.label}. ${server.warning}` : undefined}
              autoFocus={server.id === initialServerId}
              onClick={() => { void onShare(server.id); }}
            >
              <span className="queue-share-server-label">{server.label}</span>
              <ServerChoiceWarning warning={server.warning} />
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
