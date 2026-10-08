import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Minus, Plus, Tag } from 'lucide-react';
import {
  allPlaylistTags,
  playlistTagKey,
  playlistTagsFor,
  usePlaylistTagStore,
  type PlaylistTagTarget,
} from '@/features/playlist';

interface Props {
  /** One playlist, or every playlist of a multi-selection. */
  targets: readonly PlaylistTagTarget[];
  triggerId?: string;
}

type CheckState = 'true' | 'false' | 'mixed';

/**
 * Submenu for tagging one or several playlists. Same layout and hover machinery
 * as "Move to folder", but it stays open: a playlist usually gets more than one
 * tag. With a multi-selection a tag some of them carry shows as mixed; clicking
 * it gives it to all of them.
 */
export default function PlaylistTagsSubmenu({ targets, triggerId }: Props) {
  const { t } = useTranslation();
  const subRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const newNameRef = useRef<HTMLInputElement>(null);
  const [flipLeft, setFlipLeft] = useState(false);
  const [flipUp, setFlipUp] = useState(false);

  const byServer = usePlaylistTagStore(s => s.byServer);
  const addTag = usePlaylistTagStore(s => s.addTag);
  const removeTag = usePlaylistTagStore(s => s.removeTag);
  const tags = useMemo(() => allPlaylistTags(byServer), [byServer]);

  useLayoutEffect(() => {
    if (subRef.current) {
      const rect = subRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) setFlipLeft(true);
      if (rect.bottom > window.innerHeight - 8) setFlipUp(true);
    }
  }, []);

  useEffect(() => {
    if (creating && newNameRef.current) newNameRef.current.focus();
  }, [creating]);

  const checkState = (name: string): CheckState => {
    const key = playlistTagKey(name);
    const carrying = targets.filter(({ serverId, playlistId }) => (
      playlistTagsFor(byServer, serverId, playlistId).some(tag => playlistTagKey(tag) === key)
    )).length;
    if (carrying === 0) return 'false';
    return carrying === targets.length ? 'true' : 'mixed';
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    addTag(targets, newName);
    setCreating(false);
    setNewName('');
  };

  const subStyle: React.CSSProperties = flipLeft
    ? { right: '100%', left: 'auto', top: flipUp ? 'auto' : -4, bottom: flipUp ? 0 : 'auto' }
    : { left: '100%', right: 'auto', top: flipUp ? 'auto' : -4, bottom: flipUp ? 0 : 'auto' };

  return (
    <div ref={subRef} className="context-submenu" data-parent-submenu-id={triggerId} style={{ ...subStyle, minWidth: 190 }}>
      {!creating ? (
        <div className="context-menu-item context-submenu-new" onClick={e => { e.stopPropagation(); setCreating(true); }}>
          <Plus size={13} /> {t('playlists.tags.newTag')}
        </div>
      ) : (
        <div className="context-submenu-create" onClick={e => e.stopPropagation()}>
          <input
            ref={newNameRef}
            className="context-submenu-input"
            aria-label={t('playlists.tags.newTag')}
            placeholder={t('playlists.tags.namePlaceholder')}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setCreating(false); setNewName(''); }
            }}
          />
          <button type="button" className="context-submenu-create-btn" aria-label={t('playlists.tags.newTag')} onClick={handleCreate}>
            <Plus size={13} />
          </button>
        </div>
      )}
      {tags.length > 0 && <div className="context-menu-divider" />}
      {tags.map(name => {
        const state = checkState(name);
        return (
          <div
            key={playlistTagKey(name)}
            className="context-menu-item"
            role="menuitemcheckbox"
            aria-checked={state}
            onClick={e => {
              e.stopPropagation();
              if (state === 'true') removeTag(targets, name);
              else addTag(targets, name);
            }}
          >
            <Tag size={13} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
            {state === 'true' && <Check size={13} style={{ marginLeft: 'auto' }} />}
            {state === 'mixed' && <Minus size={13} style={{ marginLeft: 'auto' }} />}
          </div>
        );
      })}
    </div>
  );
}
