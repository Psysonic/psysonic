import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers3, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  libraryResolveEntitySources,
  type LibraryEntitySourceDto,
  type LibraryScopePair,
  type LibrarySourceEntityType,
} from '@/lib/api/library';
import { serverListDisplayLabel } from '@/lib/server/serverDisplayName';

interface SourceServer {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
}

interface SourceFolder {
  id: string;
  name: string;
}

interface EntitySourcePickerProps {
  entityType: LibrarySourceEntityType;
  anchorServerId: string;
  anchorId: string;
  scopes: LibraryScopePair[];
  servers: SourceServer[];
  musicFoldersByServer: Record<string, SourceFolder[]>;
  onSelect: (source: LibraryEntitySourceDto) => void;
}

function sourceLabel(
  source: LibraryEntitySourceDto,
  servers: SourceServer[],
  musicFoldersByServer: Record<string, SourceFolder[]>,
): string {
  const server = servers.find(candidate => candidate.id === source.serverId);
  const serverLabel = server
    ? serverListDisplayLabel(server, servers)
    : source.serverId;
  const folder = musicFoldersByServer[source.serverId]?.find(candidate => candidate.id === source.libraryId);
  const folderLabel = folder?.name || source.libraryId;
  return folderLabel ? `${serverLabel} · ${folderLabel}` : serverLabel;
}

/**
 * Drops entries from the anchor's own server and library. The detail page
 * resolves such a sibling to the same merged identity and renders the same
 * page, so offering it is a button that does nothing (issue #1711). Copies on
 * another server or in another library stay selectable.
 */
function alternativeSources(
  sources: LibraryEntitySourceDto[],
  anchorServerId: string,
  anchorId: string,
): LibraryEntitySourceDto[] {
  const anchor = sources.find(source => source.serverId === anchorServerId && source.id === anchorId);
  if (!anchor) return sources;
  return sources.filter(source => (
    source === anchor
    || source.serverId !== anchor.serverId
    || source.libraryId !== anchor.libraryId
  ));
}

export default function EntitySourcePicker({
  entityType,
  anchorServerId,
  anchorId,
  scopes,
  servers,
  musicFoldersByServer,
  onSelect,
}: EntitySourcePickerProps) {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState<{ key: string; sources: LibraryEntitySourceDto[] }>({
    key: '',
    sources: [],
  });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const scopeKey = JSON.stringify(scopes);
  const requestKey = `${entityType}:${anchorServerId}:${anchorId}:${scopeKey}`;
  const sources = resolved.key === requestKey
    ? alternativeSources(resolved.sources, anchorServerId, anchorId)
    : [];
  const open = openKey === requestKey;

  useEffect(() => {
    if (!anchorServerId || !anchorId || scopes.length === 0) return;
    let cancelled = false;
    void libraryResolveEntitySources(anchorServerId, {
      entityType,
      anchorServerId,
      anchorId,
      scopes,
    }).then(result => {
      if (!cancelled) setResolved({ key: requestKey, sources: result });
    }).catch(error => {
      console.error('[psysonic] entity source lookup failed:', error);
      if (!cancelled) setResolved({ key: requestKey, sources: [] });
    });
    return () => { cancelled = true; };
    // scopeKey is the stable value dependency for the ordered scope array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorId, anchorServerId, entityType, scopeKey]);

  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const pad = 8;
    setCoords({
      x: Math.max(pad, Math.min(buttonRect.left, window.innerWidth - menuRect.width - pad)),
      y: Math.max(pad, Math.min(buttonRect.bottom + 6, window.innerHeight - menuRect.height - pad)),
    });
    menu.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpenKey(null);
      buttonRef.current?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { close(); return; }
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
      if (items.length === 0) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      const focusAt = (index: number) => items[(index + items.length) % items.length].focus();
      if (event.key === 'ArrowDown') { event.preventDefault(); focusAt(current + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); focusAt(current < 0 ? -1 : current - 1); }
      else if (event.key === 'Home') { event.preventDefault(); focusAt(0); }
      else if (event.key === 'End') { event.preventDefault(); focusAt(items.length - 1); }
    };
    const onMouseDown = (event: MouseEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node)
        && !buttonRef.current?.contains(event.target as Node)
      ) close();
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  if (sources.length < 2) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="entity-source-picker__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenKey(value => value === requestKey ? null : requestKey)}
      >
        <Layers3 size={14} aria-hidden="true" />
        {t('common.availableSources', { count: sources.length })}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="entity-source-picker__menu"
          role="menu"
          aria-label={t('common.chooseSource')}
          style={{ left: coords.x, top: coords.y }}
        >
          {sources.map(source => {
            const current = source.serverId === anchorServerId && source.id === anchorId;
            const label = sourceLabel(source, servers, musicFoldersByServer);
            return (
              <button
                key={`${source.serverId}:${source.libraryId}:${source.id}`}
                type="button"
                role="menuitem"
                className="entity-source-picker__item"
                disabled={current}
                aria-current={current ? 'true' : undefined}
                onClick={() => {
                  setOpenKey(null);
                  onSelect(source);
                }}
              >
                <Server size={16} aria-hidden="true" />
                <span className="entity-source-picker__item-label">{label}</span>
                <span className="entity-source-picker__item-action">
                  {current ? t('common.currentSource') : t('common.openFromServer')}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
