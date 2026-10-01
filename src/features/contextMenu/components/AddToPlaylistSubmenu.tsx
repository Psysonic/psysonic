import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import { usePlaylistStore } from '@/features/playlist';
import { addTracksToPlaylistWithDedup, showAddTracksDedupToast } from '@/features/playlist';
import { showToast } from '@/lib/dom/toast';
import { manualPlaylistTargetsForServer } from '@/features/contextMenu/utils/contextMenuHelpers';
import { useAuthStore } from '@/store/authStore';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';
import { PlaylistTargetList } from '@/features/contextMenu/components/PlaylistTargetList';

interface Props {
  songIds: string[];
  /** When set (bulk toolbar pickers), read IDs at action time — avoids stale props if selection changes after open. */
  resolveSongIds?: () => readonly string[];
  onDone: () => void;
  dropDown?: boolean;
  triggerId?: string;
  serverId?: string;
}

export function AddToPlaylistSubmenu({ songIds, resolveSongIds, onDone, dropDown, triggerId, serverId }: Props) {
  const { t } = useTranslation();
  const subRef = useRef<HTMLDivElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);
  const requestedOwnerRef = useRef<string | null>(null);
  const songIdsRef = useRef(songIds);
  // React Compiler refs rule: ref kept in sync with the latest value for use in effects/handlers/cleanup; not render data.
  // eslint-disable-next-line react-hooks/refs
  songIdsRef.current = songIds;
  const [adding, setAdding] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [flipLeft, setFlipLeft] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const storePlaylists = usePlaylistStore((s) => s.playlists);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const touchPlaylist = usePlaylistStore((s) => s.touchPlaylist);
  const fetchPlaylistsForServer = usePlaylistStore((s) => s.fetchPlaylistsForServer);
  const activeServerId = useAuthStore(s => s.activeServerId);
  const ownerServerId = serverId ?? activeServerId ?? undefined;

  useEffect(() => {
    let current = true;
    if (!ownerServerId) {
      requestedOwnerRef.current = null;
    } else if (storePlaylists.some(playlist => playlist.serverId === ownerServerId)) {
      requestedOwnerRef.current = ownerServerId;
    } else if (requestedOwnerRef.current !== ownerServerId) {
      requestedOwnerRef.current = ownerServerId;
      void fetchPlaylistsForServer(ownerServerId, () => current);
    }
    return () => { current = false; };
  }, [fetchPlaylistsForServer, ownerServerId, storePlaylists]);

  const playlists = useMemo(
    () => manualPlaylistTargetsForServer(storePlaylists, ownerServerId),
    [storePlaylists, ownerServerId],
  );

  useLayoutEffect(() => {
    if (subRef.current) {
      const rect = subRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) setFlipLeft(true);
      if (rect.bottom > window.innerHeight - 8) setFlipUp(true);
    }
  }, []);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  const idsForAction = () => [...(resolveSongIds?.() ?? songIdsRef.current)];

  const handleAdd = async (pl: SubsonicPlaylist) => {
    if (!ownerServerId) return;
    const ids = idsForAction();
    setAdding(ownedEntityKey(pl));
    try {
      const result = await addTracksToPlaylistWithDedup(pl.id, pl.name, ids, t, ownerServerId);
      showAddTracksDedupToast(t, pl.name, result);
      if (result.outcome !== 'skipped') touchPlaylist(pl.id, ownerServerId);
    } catch {
      showToast(t('playlists.addError'), 3000, 'error');
    }
    setAdding(null);
    onDone();
  };

  const handleCreate = async () => {
    if (!ownerServerId) return;
    const ids = idsForAction();
    const name = newName.trim() || t('playlists.unnamed');
    try {
      const pl = await createPlaylist(name, ids, ownerServerId);
      if (pl?.id) {
        showToast(t('playlists.createAndAddSuccess', { count: ids.length, playlist: pl.name || name }));
      }
    } catch {
      showToast(t('playlists.createError'), 3000, 'error');
    }
    onDone();
  };

  // Flush to the parent edge (left/right/top 100%). Actual “hole” cases are handled
  // in ContextMenu via a short delayed mouseleave + :hover check on the trigger row.
  const subStyle: React.CSSProperties = dropDown
    ? { top: '100%', left: 0, right: 'auto' }
    : flipLeft
      ? { right: '100%', left: 'auto', top: flipUp ? 'auto' : -4, bottom: flipUp ? 0 : 'auto' }
      : { left: '100%', right: 'auto', top: flipUp ? 'auto' : -4, bottom: flipUp ? 0 : 'auto' };

  return (
    <div
      className="context-submenu"
      data-parent-submenu-id={triggerId ?? ''}
      ref={subRef}
      style={subStyle}
      onMouseDown={dropDown ? (e) => e.stopPropagation() : undefined}
    >
      {!creating ? (
        <div
          className="context-menu-item context-submenu-new"
          onClick={e => { e.stopPropagation(); setCreating(true); }}
        >
          <Plus size={13} /> {t('playlists.newPlaylist')}
        </div>
      ) : (
        <div className="context-submenu-create" onClick={e => e.stopPropagation()}>
          <input
            ref={newNameRef}
            className="context-submenu-input"
            placeholder={t('playlists.createName')}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setCreating(false); setNewName(''); }
            }}
          />
          <button className="context-submenu-create-btn" onClick={handleCreate}>
            <Plus size={13} />
          </button>
        </div>
      )}

      <div className="context-menu-divider" />

      <PlaylistTargetList
        targets={playlists}
        serverId={ownerServerId}
        emptyLabel={t('playlists.empty')}
        busyKey={adding}
        onPick={handleAdd}
      />
    </div>
  );
}
