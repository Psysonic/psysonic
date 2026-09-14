import React from 'react';
import { useTranslation } from 'react-i18next';
import { LibraryBig, Share2, User, Users } from 'lucide-react';
import SortDropdown from '@/ui/SortDropdown';
import { usePlaylistLayoutStore } from '@/features/playlist/store/playlistLayoutStore';
import {
  hasSharedPlaylists,
  type PlaylistOwnershipBucket,
  type PlaylistOwnershipFilter,
} from '@/features/playlist/utils/playlistOwnership';

interface Props {
  counts: Record<PlaylistOwnershipBucket, number>;
}

const OPTIONS: Array<{
  value: PlaylistOwnershipFilter;
  labelKey: string;
  Icon: typeof User;
}> = [
  { value: 'all', labelKey: 'playlists.ownership.all', Icon: LibraryBig },
  { value: 'personal', labelKey: 'playlists.ownership.personal', Icon: User },
  { value: 'sharedByMe', labelKey: 'playlists.ownership.sharedByMe', Icon: Share2 },
  { value: 'sharedWithMe', labelKey: 'playlists.ownership.sharedWithMe', Icon: Users },
];

/**
 * Header control splitting the Playlists page into personal / shared-by-me /
 * shared-with-me.
 *
 * Hidden while every playlist is personal — on a single-user server the control
 * would offer three empty buckets, the same reason the folder toggle waits for a
 * folder to exist. It filters the list the page already holds, so it composes
 * with folder view and the scoped text search instead of competing with them.
 *
 * The exception keeps the page escapable: the selection is persisted, so if the
 * last shared playlist disappears (unshared, scope narrowed to a single-user
 * server) while a shared bucket is active, hiding the control unconditionally
 * would strand the user on an empty list with nothing to clear — across
 * restarts. Whenever a filter is applied, the way out stays on screen.
 */
export default function PlaylistsOwnershipFilter({ counts }: Props) {
  const { t } = useTranslation();
  const ownershipFilter = usePlaylistLayoutStore(s => s.ownershipFilter);
  const setOwnershipFilter = usePlaylistLayoutStore(s => s.setOwnershipFilter);

  if (!hasSharedPlaylists(counts) && ownershipFilter === 'all') return null;

  // One dropdown rather than four buttons: the header row already carries real
  // actions, and four more of them read as actions too while being a single
  // choice. Same control the list sort uses, so the toolbar stays one row.
  const ActiveIcon = (OPTIONS.find(o => o.value === ownershipFilter) ?? OPTIONS[0]).Icon;

  return (
    <SortDropdown
      value={ownershipFilter}
      options={OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
      onChange={setOwnershipFilter}
      ariaLabel={t('playlists.ownership.groupLabel')}
      tooltip={t('playlists.ownership.groupLabel')}
      icon={<ActiveIcon size={14} />}
    />
  );
}
