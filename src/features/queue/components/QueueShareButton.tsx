import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ServerChoiceOption } from '@/ui/ServerChoiceList';
import { ServerChoiceWarning } from '@/ui/ServerChoiceList';
import {
  ShareMethodSubmenu,
  ShareSubmenuTriggerIcon,
  type OutboundShareRequest,
} from '@/features/share';

interface Props {
  label: string;
  open: boolean;
  options: ServerChoiceOption[];
  initialServerId: string;
  onTrigger: () => void;
  onClose: () => void;
  onShare: (serverId: string) => Promise<void>;
  requestForServer?: (serverId: string) => OutboundShareRequest;
}

export function QueueShareButton({
  label,
  open,
  options,
  initialServerId,
  onTrigger,
  onClose,
  onShare,
  requestForServer,
}: Props) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const serverButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });
  const [activeServerId, setActiveServerId] = useState<string | null>(null);

  const openServerMethods = (serverId: string, focusFirstMethod = false) => {
    setActiveServerId(serverId);
    if (!focusFirstMethod) return;
    requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(`[data-queue-share-submenu="${serverId}"] .share-method-item`)
        ?.focus({ preventScroll: true });
    });
  };

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
      setActiveServerId(null);
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setActiveServerId(null);
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
        onClick={() => {
          if (open) setActiveServerId(null);
          onTrigger();
        }}
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
          onKeyDown={event => {
            const target = event.target as HTMLElement;
            if (event.key === 'ArrowLeft' && target.closest('.share-method-menu') && activeServerId) {
              event.preventDefault();
              event.stopPropagation();
              setActiveServerId(null);
              serverButtonRefs.current.get(activeServerId)?.focus({ preventScroll: true });
              return;
            }
            const serverButton = target.closest<HTMLButtonElement>('[data-queue-share-server]');
            if (event.key === 'ArrowRight' && serverButton && requestForServer) {
              event.preventDefault();
              openServerMethods(serverButton.dataset.queueShareServer!, true);
              return;
            }
            if (
              (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')
              || target.closest('.share-method-menu')
            ) return;
            const items = [...panelRef.current?.querySelectorAll<HTMLButtonElement>('[data-queue-share-server]') ?? []];
            if (items.length === 0) return;
            event.preventDefault();
            const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = activeIndex < 0
              ? (delta > 0 ? 0 : items.length - 1)
              : (activeIndex + delta + items.length) % items.length;
            items[nextIndex]?.focus({ preventScroll: true });
          }}
        >
          {requestForServer && options.length > 1 && (
            <div className="queue-share-scope-note" role="note">
              <span className="queue-share-scope-note__title">{t('queue.multiServerShareTitle')}</span>
              <span className="queue-share-scope-note__hint">{t('queue.multiServerShareHint')}</span>
            </div>
          )}
          {options.map(server => {
            const methodsOpen = activeServerId === server.id;
            return (
              <div
                key={server.id}
                className="queue-share-server-row"
                onMouseEnter={() => {
                  if (requestForServer) openServerMethods(server.id);
                }}
                onMouseLeave={() => {
                  if (activeServerId === server.id) setActiveServerId(null);
                }}
              >
                <button
                  ref={node => {
                    if (node) serverButtonRefs.current.set(server.id, node);
                    else serverButtonRefs.current.delete(server.id);
                  }}
                  type="button"
                  role="menuitem"
                  className={`nav-library-dropdown-item queue-share-server-item${methodsOpen ? ' active' : ''}`}
                  data-queue-share-server={server.id}
                  aria-label={server.warning ? `${server.label}. ${server.warning}` : undefined}
                  aria-haspopup={requestForServer ? 'menu' : undefined}
                  aria-expanded={requestForServer ? methodsOpen : undefined}
                  autoFocus={server.id === initialServerId}
                  onClick={() => {
                    if (requestForServer) openServerMethods(server.id, true);
                    else void onShare(server.id);
                  }}
                >
                  <span className="queue-share-server-label">{server.label}</span>
                  <ServerChoiceWarning warning={server.warning} />
                  {requestForServer && <ShareSubmenuTriggerIcon />}
                </button>
                {requestForServer && methodsOpen && (
                  <div data-queue-share-submenu={server.id}>
                    <ShareMethodSubmenu
                      request={requestForServer(server.id)}
                      triggerId={`queue-share-${server.id}`}
                      onDone={() => {
                        setActiveServerId(null);
                        onClose();
                        triggerRef.current?.focus();
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
