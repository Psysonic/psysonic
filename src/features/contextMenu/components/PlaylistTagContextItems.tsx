import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { usePlaylistTagStore } from '@/features/playlist';
import type { ContextMenuItemsProps } from '@/features/contextMenu/components/contextMenuItemTypes';

/**
 * Menu for a tag chip on the Playlists page. Tags are local, so both actions
 * stay available offline. Rename happens inline in the menu, the way a new
 * folder is named in "Move to folder".
 */
export default function PlaylistTagContextItems({ item, closeContextMenu }: ContextMenuItemsProps) {
  const { t } = useTranslation();
  const name = (item as { name: string }).name;
  const renameTag = usePlaylistTagStore(s => s.renameTag);
  const deleteTag = usePlaylistTagStore(s => s.deleteTag);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming]);

  const commitRename = () => {
    if (draft.trim()) renameTag(name, draft);
    closeContextMenu();
  };

  return (
    <>
      <div className="context-menu-header">{name}</div>
      {renaming ? (
        <div className="context-submenu-create" onClick={e => e.stopPropagation()}>
          <input
            ref={inputRef}
            className="context-submenu-input"
            aria-label={t('playlists.tags.rename')}
            placeholder={t('playlists.tags.namePlaceholder')}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename();
            }}
          />
          <button
            type="button"
            className="context-submenu-create-btn"
            aria-label={t('playlists.tags.rename')}
            onClick={commitRename}
          >
            <Check size={13} />
          </button>
        </div>
      ) : (
        <div className="context-menu-item" onClick={() => setRenaming(true)}>
          <Pencil size={14} /> {t('playlists.tags.rename')}
        </div>
      )}
      <div
        className="context-menu-item"
        style={{ color: 'var(--danger)' }}
        onClick={() => {
          if (!confirmDelete) {
            setConfirmDelete(true);
            return;
          }
          deleteTag(name);
          closeContextMenu();
        }}
      >
        <Trash2 size={14} /> {confirmDelete ? t('playlists.tags.deleteConfirm') : t('playlists.tags.delete')}
      </div>
    </>
  );
}
