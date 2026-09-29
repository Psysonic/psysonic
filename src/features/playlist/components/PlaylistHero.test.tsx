import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicPlaylist, SubsonicSong } from '@/lib/api/subsonicTypes';
import { offlineActionPolicy } from '@/features/offline';
import PlaylistHero from '@/features/playlist/components/PlaylistHero';
import { usePlaylistLayoutStore } from '@/features/playlist/store/playlistLayoutStore';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigateMock };
});

function playlist(over: Partial<SubsonicPlaylist> = {}): SubsonicPlaylist {
  return {
    id: 'pl-1',
    name: 'Feishin mix',
    smart: true,
    songCount: 1,
    duration: 120,
    created: '',
    changed: '',
    serverId: 'srv-a',
    ...over,
  };
}

function renderHero(pl: SubsonicPlaylist, handleRefreshSmart = vi.fn()) {
  return renderWithProviders(
    <PlaylistHero
      playlist={pl}
      songs={[{ id: 'song-1' } as SubsonicSong]}
      id={pl.id}
      customCoverId={null}
      coverQuadIds={[null, null, null, null]}
      resolvedBgUrl={null}
      saving={false}
      refreshingSmart={false}
      searchOpen={false}
      csvImporting={false}
      activeZip={undefined}
      offlineStatus="none"
      offlineProgress={null}
      activeServerId="srv-a"
      actionPolicy={offlineActionPolicy('playlistDetail', false)}
      setEditingMeta={vi.fn()}
      setSearchOpen={vi.fn()}
      setSearchQuery={vi.fn()}
      setSearchResults={vi.fn()}
      setSelectedSearchIds={vi.fn()}
      setSearchPlPickerOpen={vi.fn()}
      handlePlayAll={vi.fn()}
      handleShuffleAll={vi.fn()}
      handleEnqueueAll={vi.fn()}
      handleImportCsv={vi.fn()}
      handleDownload={vi.fn()}
      handleRefreshSmart={handleRefreshSmart}
      deleteAlbum={vi.fn()}
      downloadPlaylist={vi.fn()}
    />,
  );
}

describe('PlaylistHero smart surfaces', () => {
  beforeEach(() => {
    usePlaylistLayoutStore.getState().reset();
  });

  it('hides add/import and exposes Edit Rules for smart playlists', async () => {
    const user = userEvent.setup();
    const handleRefreshSmart = vi.fn();
    navigateMock.mockReset();
    const view = renderHero(playlist(), handleRefreshSmart);

    expect(view.queryByRole('button', { name: 'Search your library to add tracks' })).not.toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Import from Spotify CSV' })).not.toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Cache playlist offline' })).not.toBeInTheDocument();

    // Icon-only: the label lives in the accessible name and tooltip, not in the bar.
    expect(view.getByRole('button', { name: 'Edit Rules' })).toHaveTextContent('');
    await user.click(view.getByRole('button', { name: 'Edit Rules' }));
    expect(navigateMock).toHaveBeenCalledWith('/playlists', {
      state: { openSmartEditorFor: { id: 'pl-1', serverId: 'srv-a', name: 'Feishin mix' } },
    });
    await user.click(view.getByRole('button', { name: 'Refresh smart playlist' }));
    expect(handleRefreshSmart).toHaveBeenCalledOnce();
  });

  it('keeps add/import on regular playlists and omits Edit Rules', () => {
    const view = renderHero(playlist({ name: 'Manual mix', smart: false }));
    expect(view.getByRole('button', { name: 'Search your library to add tracks' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Import from Spotify CSV' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Cache playlist offline' })).toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Edit Rules' })).not.toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Refresh smart playlist' })).not.toBeInTheDocument();
  });

  it('fails closed for offline caching when Navidrome metadata is unavailable', () => {
    const view = renderHero(playlist({
      name: 'Unclassified mix',
      smart: undefined,
      smartMetadataUnavailable: true,
    }));

    expect(view.queryByRole('button', { name: 'Cache playlist offline' })).not.toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Edit Rules' })).not.toBeInTheDocument();
  });

  it('respects playlist layout visibility for smart actions', () => {
    usePlaylistLayoutStore.getState().toggleItem('editRules');
    usePlaylistLayoutStore.getState().toggleItem('refreshSmart');
    const view = renderHero(playlist());

    expect(view.queryByRole('button', { name: 'Edit Rules' })).not.toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Refresh smart playlist' })).not.toBeInTheDocument();
  });
});

describe('PlaylistHero action bar layout', () => {
  beforeEach(() => {
    usePlaylistLayoutStore.getState().reset();
  });

  function barButtonNames(view: ReturnType<typeof renderHero>): string[] {
    const bar = view.container.querySelector('.album-detail-actions-primary');
    return Array.from(bar?.querySelectorAll('button') ?? []).map(b => b.getAttribute('aria-label') ?? '');
  }

  it('keeps Play first and renders the rest in the configured order', () => {
    const { items, setItems } = usePlaylistLayoutStore.getState();
    const byId = (id: string) => items.find(i => i.id === id)!;
    setItems([
      byId('downloadZip'), byId('shuffle'), byId('importCsv'),
      ...items.filter(i => !['downloadZip', 'shuffle', 'importCsv'].includes(i.id)),
    ]);
    const names = barButtonNames(renderHero(playlist({ name: 'Manual mix', smart: false })));

    expect(names[0]).toBe('Play playlist');
    expect(names.indexOf('Download (ZIP)')).toBeLessThan(names.indexOf('Shuffle'));
    expect(names.indexOf('Shuffle')).toBeLessThan(names.indexOf('Import from Spotify CSV'));
  });

  it('hides the primary buttons when switched off', () => {
    usePlaylistLayoutStore.getState().toggleItem('shuffle');
    usePlaylistLayoutStore.getState().toggleItem('enqueue');
    const names = barButtonNames(renderHero(playlist({ name: 'Manual mix', smart: false })));

    expect(names).toContain('Play playlist');
    expect(names).not.toContain('Shuffle');
    expect(names).not.toContain('Add to Queue');
  });
});
