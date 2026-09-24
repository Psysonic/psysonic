import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { offlineActionPolicy } from '@/features/offline';
import AlbumHeaderActionBar from '@/features/album/components/AlbumHeaderActionBar';
import { useAlbumHeaderLayoutStore } from '@/features/album/store/albumHeaderLayoutStore';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

function renderBar(over: Partial<Parameters<typeof AlbumHeaderActionBar>[0]> = {}) {
  const props = {
    albumId: 'al-1',
    serverId: 'srv-a',
    policy: offlineActionPolicy('albumDetail', false),
    isStarred: false,
    showBioButton: true,
    totalSize: 0,
    downloadProgress: null,
    offlineStatus: 'none' as const,
    offlineProgress: null,
    onPlayAll: vi.fn(),
    onShuffleAll: vi.fn(),
    onEnqueueAll: vi.fn(),
    onToggleStar: vi.fn(),
    onBio: vi.fn(),
    onDownload: vi.fn(),
    onCacheOffline: vi.fn(),
    onRemoveOffline: vi.fn(),
    ...over,
  };
  const view = renderWithProviders(<AlbumHeaderActionBar {...props} />);
  const names = () => Array.from(view.container.querySelectorAll('button'))
    .map(b => b.getAttribute('aria-label') ?? '');
  return { view, props, names };
}

describe('AlbumHeaderActionBar', () => {
  beforeEach(() => {
    useAlbumHeaderLayoutStore.getState().reset();
  });

  it('renders Play first and the other buttons in the default order', () => {
    const { names } = renderBar();
    expect(names()).toEqual([
      'Play this album',
      'Shuffle',
      'Add entire album to queue',
      'Add to Favorites',
      'Share album',
      'Read the artist biography',
      'Download this album as a ZIP',
      'Make available offline',
    ]);
  });

  it('shows Bio, Download and Offline as icon-only buttons', () => {
    const { view } = renderBar();
    for (const name of ['Read the artist biography', 'Download this album as a ZIP', 'Make available offline']) {
      expect(view.getByRole('button', { name })).toHaveTextContent('');
    }
  });

  it('moves the album size into the download tooltip', () => {
    const { view } = renderBar({ totalSize: 54.9 * 1024 * 1024 });
    const download = view.getByRole('button', { name: /Download this album as a ZIP · / });
    expect(download.getAttribute('data-tooltip')).toBe(download.getAttribute('aria-label'));
  });

  it('follows the configured order and visibility', () => {
    const { buttons, setButtons, toggleButton } = useAlbumHeaderLayoutStore.getState();
    setButtons([...buttons].reverse());
    toggleButton('favorite');
    const { names } = renderBar();
    expect(names()).toEqual([
      'Play this album',
      'Make available offline',
      'Download this album as a ZIP',
      'Read the artist biography',
      'Share album',
      'Add entire album to queue',
      'Shuffle',
    ]);
  });

  it('keeps the hidden-by-context rules when the button is visible in the layout', () => {
    const { names } = renderBar({ showBioButton: false, onShuffleAll: undefined });
    expect(names()).not.toContain('Read the artist biography');
    expect(names()).not.toContain('Shuffle');
  });

  it('wires each button to its handler', async () => {
    const user = userEvent.setup();
    const { view, props } = renderBar();
    await user.click(view.getByRole('button', { name: 'Read the artist biography' }));
    await user.click(view.getByRole('button', { name: 'Download this album as a ZIP' }));
    await user.click(view.getByRole('button', { name: 'Make available offline' }));
    expect(props.onBio).toHaveBeenCalledOnce();
    expect(props.onDownload).toHaveBeenCalledOnce();
    expect(props.onCacheOffline).toHaveBeenCalledOnce();
  });
});
