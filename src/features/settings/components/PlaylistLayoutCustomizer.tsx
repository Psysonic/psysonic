import { useTranslation } from 'react-i18next';
import { Download, FileUp, HardDrive, Lightbulb, ListPlus, RefreshCw, Search, Share2, Shuffle, Sparkles } from 'lucide-react';
import { usePlaylistLayoutStore, type PlaylistLayoutItemId } from '@/features/playlist';
import { ActionBarLayoutCustomizer } from '@/features/settings/components/ActionBarLayoutCustomizer';

const PLAYLIST_LAYOUT_ICONS: Record<PlaylistLayoutItemId, typeof Search> = {
  shuffle:      Shuffle,
  enqueue:      ListPlus,
  share:        Share2,
  editRules:    Sparkles,
  refreshSmart: RefreshCw,
  addSongs:     Search,
  importCsv:    FileUp,
  downloadZip:  Download,
  offlineCache: HardDrive,
  suggestions:  Lightbulb,
};

const PLAYLIST_LAYOUT_LABEL_KEYS: Record<PlaylistLayoutItemId, string> = {
  shuffle:      'playlists.shuffle',
  enqueue:      'playlists.addToQueue',
  share:        'contextMenu.shareLink',
  editRules:    'playlists.editRules',
  refreshSmart: 'playlists.refreshSmart',
  addSongs:     'playlists.addSongs',
  importCsv:    'playlists.importCSV',
  downloadZip:  'playlists.downloadZip',
  offlineCache: 'playlists.cacheOffline',
  suggestions:  'playlists.suggestions',
};

/** Suggestions is a page section below the list, so it is toggled but not ordered with the bar. */
const FIXED_IDS: readonly PlaylistLayoutItemId[] = ['suggestions'];

export function PlaylistLayoutCustomizer() {
  const { t } = useTranslation();
  const items = usePlaylistLayoutStore(s => s.items);
  const setItems = usePlaylistLayoutStore(s => s.setItems);
  const toggleItem = usePlaylistLayoutStore(s => s.toggleItem);

  const labels = Object.fromEntries(
    Object.entries(PLAYLIST_LAYOUT_LABEL_KEYS).map(([id, key]) => [id, t(key)]),
  ) as Record<PlaylistLayoutItemId, string>;

  return (
    <ActionBarLayoutCustomizer
      items={items}
      icons={PLAYLIST_LAYOUT_ICONS}
      labels={labels}
      reorderType="playlist_layout_reorder"
      onReorder={setItems}
      onToggle={toggleItem}
      fixedIds={FIXED_IDS}
    />
  );
}
