import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import i18n from '@/lib/i18n';
import type { SubsonicArtist, SubsonicPlaylist } from '@/lib/api/subsonicTypes';
import DeviceSyncBrowserPanel from './DeviceSyncBrowserPanel';

function renderPanel(activeTab: 'playlists' | 'artists') {
  renderWithProviders(
    <DeviceSyncBrowserPanel
      activeTab={activeTab}
      setActiveTab={vi.fn()}
      search=""
      setSearch={vi.fn()}
      playlists={[{ id: 'p1', name: 'Mix', songCount: 3 } as SubsonicPlaylist]}
      randomAlbums={[]}
      albumSearchResults={[]}
      albumSearchLoading={false}
      artists={[{ id: 'a1', name: 'Someone', albumCount: 5 } as SubsonicArtist]}
      loadingBrowser={false}
      expandedArtistIds={new Set()}
      artistAlbumsMap={new Map()}
      loadingArtistIds={new Set()}
      toggleArtistExpand={vi.fn(async () => {})}
      serverIndexKey="server.test"
      serverProfileId={null}
      unresolvedOwnerKey={null}
      loadFailed={false}
      sources={[]}
      pendingDeletion={[]}
      handleToggleSource={vi.fn()}
      disabled={false}
    />,
    // German, because the English wording matched the old hard-coded text.
    { language: 'de' },
  );
}

describe('DeviceSyncBrowserPanel counts', () => {
  it('labels a playlist with its translated song count', () => {
    renderPanel('playlists');
    expect(screen.getByText(new RegExp(i18n.t('sidebar.playlistSongCount', { count: 3 })))).toBeInTheDocument();
  });

  it('labels an artist with its translated album count', () => {
    renderPanel('artists');
    expect(screen.getByText(i18n.t('artists.albumCount', { count: 5 }))).toBeInTheDocument();
  });
});
