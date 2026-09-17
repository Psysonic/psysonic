import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, CircleHelp, Loader2, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  outboundShareUnavailableHelp,
  useOutboundShareModel,
  type OutboundShareModel,
  type OutboundShareRequest,
  type OutboundShareMethod,
} from '@/features/share/outboundShare';
import { useShareSettingsStore } from '@/features/share/store/shareSettingsStore';

interface ContentProps {
  request: OutboundShareRequest;
  onDone: () => void;
}

export function ShareMethodMenuContent({ request, onDone }: ContentProps) {
  const { t } = useTranslation();
  const model = useOutboundShareModel(request, t);
  const [busyMethod, setBusyMethod] = useState<OutboundShareMethod | null>(null);

  return model.methods.map(method => (
    <ShareMethodRow
      key={method.id}
      method={method}
      busy={busyMethod === method.id}
      blocked={busyMethod !== null}
      onShare={async () => {
        if (busyMethod !== null) return;
        setBusyMethod(method.id);
        const copied = await model.share(method.id);
        setBusyMethod(null);
        if (copied) onDone();
      }}
    />
  ));
}

function ShareMethodRow({
  method,
  busy,
  blocked,
  onShare,
}: {
  method: OutboundShareModel['methods'][number];
  busy: boolean;
  blocked: boolean;
  onShare: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const helpPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpOpen) return;
    requestAnimationFrame(() => helpPopoverRef.current?.focus({ preventScroll: true }));
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (helpButtonRef.current?.contains(target) || helpPopoverRef.current?.contains(target)) return;
      setHelpOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [helpOpen]);

  return (
    <div className="share-method-row">
      <button
        type="button"
        className={`context-menu-item share-method-item${method.available ? '' : ' is-disabled'}`}
        role="menuitem"
        tabIndex={-1}
        aria-disabled={!method.available || blocked || undefined}
        aria-busy={busy || undefined}
        onClick={() => {
          if (!method.available || blocked) return;
          void onShare();
        }}
      >
        {busy ? <Loader2 size={13} className="spin" /> : <Share2 size={13} />}
        <span>{method.label}</span>
      </button>
      {!method.available && method.reason && (
        <>
          <button
            ref={helpButtonRef}
            type="button"
            className="share-method-help"
            aria-label={t('shared.methodHelpLabel', { method: method.label })}
            aria-expanded={helpOpen}
            onClick={event => {
              event.stopPropagation();
              setHelpOpen(current => !current);
            }}
            onKeyDown={event => {
              if (event.key !== 'Escape' || !helpOpen) return;
              event.preventDefault();
              event.stopPropagation();
              setHelpOpen(false);
            }}
          >
            <CircleHelp size={13} />
          </button>
          {helpOpen && (
            <div
              ref={helpPopoverRef}
              className="share-method-help-popover"
              role="dialog"
              aria-label={t('shared.methodHelpLabel', { method: method.label })}
              tabIndex={-1}
              onKeyDown={event => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                setHelpOpen(false);
                helpButtonRef.current?.focus();
              }}
            >
              {outboundShareUnavailableHelp(method.reason, t)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface SubmenuProps extends ContentProps {
  triggerId: string;
}

export function ShareMethodSubmenu({ request, triggerId, onDone }: SubmenuProps) {
  const submenuRef = useRef<HTMLDivElement>(null);
  const [flipLeft, setFlipLeft] = useState(false);
  const [flipUp, setFlipUp] = useState(false);

  useLayoutEffect(() => {
    const submenu = submenuRef.current;
    if (!submenu) return;
    const rect = submenu.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) setFlipLeft(true);
    if (rect.bottom > window.innerHeight - 8) setFlipUp(true);
  }, []);

  return (
    <div
      ref={submenuRef}
      className="context-submenu share-method-menu"
      data-parent-submenu-id={triggerId}
      role="menu"
      style={flipLeft
        ? { right: '100%', left: 'auto', top: flipUp ? 'auto' : -4, bottom: flipUp ? 0 : 'auto' }
        : { left: '100%', right: 'auto', top: flipUp ? 'auto' : -4, bottom: flipUp ? 0 : 'auto' }}
    >
      <ShareMethodMenuContent request={request} onDone={onDone} />
    </div>
  );
}

interface ContextItemProps extends ContentProps {
  triggerId: string;
  label: string;
  activeSubmenuId: string | null;
  setActiveSubmenuId: (id: string | null) => void;
  cancelSubmenuCloseTimer: () => void;
  onSubmenuTriggerMouseLeave: (event: ReactMouseEvent<HTMLElement>) => void;
}

export function ContextShareMenuItem({
  request,
  triggerId,
  label,
  activeSubmenuId,
  setActiveSubmenuId,
  cancelSubmenuCloseTimer,
  onSubmenuTriggerMouseLeave,
  onDone,
}: ContextItemProps) {
  const navidromeSharingEnabled = useShareSettingsStore(state => state.navidromeSharingEnabled);
  if (!navidromeSharingEnabled) {
    return (
      <DirectContextShareMenuItem
        request={request}
        label={label}
        cancelSubmenuCloseTimer={cancelSubmenuCloseTimer}
        setActiveSubmenuId={setActiveSubmenuId}
        onDone={onDone}
      />
    );
  }
  const open = activeSubmenuId === triggerId;
  return (
    <div
      className={`context-menu-item context-menu-item--submenu${open ? ' active' : ''}`}
      data-submenu-id={triggerId}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={event => {
        event.stopPropagation();
        cancelSubmenuCloseTimer();
        setActiveSubmenuId(triggerId);
      }}
      onMouseEnter={() => {
        cancelSubmenuCloseTimer();
        setActiveSubmenuId(triggerId);
      }}
      onMouseLeave={onSubmenuTriggerMouseLeave}
    >
      <Share2 size={14} /> {label}
      <ShareSubmenuTriggerIcon />
      {open && <ShareMethodSubmenu request={request} triggerId={triggerId} onDone={onDone} />}
    </div>
  );
}

function DirectContextShareMenuItem({
  request,
  label,
  cancelSubmenuCloseTimer,
  setActiveSubmenuId,
  onDone,
}: Pick<ContextItemProps, 'request' | 'label' | 'cancelSubmenuCloseTimer' | 'setActiveSubmenuId' | 'onDone'>) {
  const { t } = useTranslation();
  const model = useOutboundShareModel(request, t);
  const [busy, setBusy] = useState(false);
  const method = model.methods.find(candidate => candidate.id === 'psysonic');

  return (
    <div
      className={`context-menu-item${method?.available ? '' : ' is-disabled'}`}
      aria-disabled={!method?.available || busy || undefined}
      aria-busy={busy || undefined}
      onClick={event => {
        event.stopPropagation();
        if (!method?.available || busy) return;
        setBusy(true);
        void model.share('psysonic').then(copied => {
          if (copied) onDone();
        }).finally(() => setBusy(false));
      }}
      onMouseEnter={() => {
        cancelSubmenuCloseTimer();
        setActiveSubmenuId(null);
      }}
    >
      {busy ? <Loader2 size={14} className="spin" /> : <Share2 size={14} />} {label}
    </div>
  );
}

interface ButtonProps {
  request: OutboundShareRequest;
  label: string;
  className: string;
  iconSize?: number;
}

export function ShareMethodMenuButton(props: ButtonProps) {
  const navidromeSharingEnabled = useShareSettingsStore(state => state.navidromeSharingEnabled);
  return navidromeSharingEnabled
    ? <ShareMethodPickerButton {...props} />
    : <DirectShareButton {...props} />;
}

function DirectShareButton({ request, label, className, iconSize = 16 }: ButtonProps) {
  const { t } = useTranslation();
  const model = useOutboundShareModel(request, t);
  const [busy, setBusy] = useState(false);
  const method = model.methods.find(candidate => candidate.id === 'psysonic');

  return (
    <button
      type="button"
      className={className}
      disabled={!method?.available || busy}
      aria-label={label}
      aria-busy={busy || undefined}
      data-tooltip={label}
      onClick={() => {
        if (!method?.available || busy) return;
        setBusy(true);
        void model.share('psysonic').finally(() => setBusy(false));
      }}
    >
      {busy ? <Loader2 size={iconSize} className="spin" /> : <Share2 size={iconSize} />}
    </button>
  );
}

function ShareMethodPickerButton({ request, label, className, iconSize = 16 }: ButtonProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const rect = trigger.getBoundingClientRect();
      const width = panel.offsetWidth;
      setPosition({
        top: Math.min(rect.bottom + 6, window.innerHeight - panel.offsetHeight - 8),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        ready: true,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('.share-method-item')?.focus({ preventScroll: true });
    });
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as Element | null;
      if (
        panelRef.current?.querySelector('.share-method-help-popover')
        && (target?.closest('.share-method-help') || target?.closest('.share-method-help-popover'))
      ) return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        onClick={() => setOpen(current => !current)}
        onContextMenu={event => {
          event.preventDefault();
          setOpen(true);
        }}
        aria-label={label}
        data-tooltip={open ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Share2 size={iconSize} />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="context-submenu share-method-menu share-method-menu--anchored"
          role="menu"
          aria-label={label}
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            visibility: position.ready ? 'visible' : 'hidden',
          }}
          onKeyDown={event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('.share-method-item') ?? [])];
            if (items.length === 0) return;
            event.preventDefault();
            const activeIndex = items.indexOf(document.activeElement as HTMLElement);
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = activeIndex < 0
              ? (delta > 0 ? 0 : items.length - 1)
              : (activeIndex + delta + items.length) % items.length;
            items[nextIndex]?.focus({ preventScroll: true });
          }}
        >
          <ShareMethodMenuContent request={request} onDone={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }} />
        </div>,
        document.body,
      )}
    </>
  );
}

export function ShareSubmenuTriggerIcon() {
  return <ChevronRight size={13} style={{ marginLeft: 'auto' }} />;
}
