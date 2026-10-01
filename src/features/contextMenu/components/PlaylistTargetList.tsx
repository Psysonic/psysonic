import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListMusic } from 'lucide-react';
import type { SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import { usePlaylistStore } from '@/features/playlist';
import { splitPlaylistTargets } from '@/features/contextMenu/utils/contextMenuHelpers';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

interface Props {
  targets: readonly SubsonicPlaylist[];
  serverId: string | undefined;
  emptyLabel: string;
  /** Key (`ownedEntityKey`) of the target being written to, if any; the list is inert meanwhile. */
  busyKey?: string | null;
  onPick: (playlist: SubsonicPlaylist) => void;
}

/**
 * The target rows of an add-to-playlist submenu: a "Recently used" section
 * when the list is long enough, then every target alphabetically.
 */
export function PlaylistTargetList({ targets, serverId, emptyLabel, busyKey, onPick }: Props) {
  const { t } = useTranslation();
  const recentIds = usePlaylistStore(s => s.recentIds);
  const { recent, all } = useMemo(
    () => splitPlaylistTargets(targets, recentIds, serverId),
    [targets, recentIds, serverId],
  );

  if (all.length === 0) return <div className="context-submenu-empty">{emptyLabel}</div>;

  const row = (playlist: SubsonicPlaylist, keyPrefix: string) => {
    const key = ownedEntityKey(playlist);
    return (
      <div
        key={`${keyPrefix}${key}`}
        className="context-menu-item"
        onClick={() => onPick(playlist)}
        style={{ opacity: busyKey === key ? 0.5 : 1, pointerEvents: busyKey ? 'none' : undefined }}
      >
        <ListMusic size={13} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{playlist.name}</span>
      </div>
    );
  };

  return (
    <>
      {recent.length > 0 && (
        <>
          <div className="context-submenu-label">{t('playlists.recentTargets')}</div>
          {recent.map(playlist => row(playlist, 'recent:'))}
          <div className="context-menu-divider" />
        </>
      )}
      {all.map(playlist => row(playlist, ''))}
    </>
  );
}
