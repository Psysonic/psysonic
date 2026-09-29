import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import ShareSearchResults from '@/features/search/components/ShareSearchResults';

const playlist = {
  id: 'playlist-1',
  name: 'Shared Playlist',
  songCount: 3,
  duration: 540,
  created: '',
  changed: '',
  serverId: 'shared',
};

function renderPlaylistResult(variant: 'desktop' | 'mobile', onOpenPlaylist: () => void) {
  return renderWithProviders(
    <ShareSearchResults
      variant={variant}
      shareMatch={{
        type: 'playlist',
        payload: { srv: 'https://shared.example.com', k: 'playlist', id: 'playlist-1' },
      }}
      shareQueueBusy={false}
      onEnqueue={vi.fn()}
      onOpenAlbum={vi.fn()}
      onOpenArtist={vi.fn()}
      onOpenComposer={vi.fn()}
      onOpenPlaylist={onOpenPlaylist}
      shareTrackSong={null}
      shareTrackResolving={false}
      shareTrackUnavailable={false}
      shareAlbum={null}
      shareAlbumResolving={false}
      shareAlbumUnavailable={false}
      shareArtist={null}
      shareArtistResolving={false}
      shareArtistUnavailable={false}
      shareComposer={null}
      shareComposerResolving={false}
      shareComposerUnavailable={false}
      sharePlaylist={playlist}
      sharePlaylistResolving={false}
      sharePlaylistUnavailable={false}
      navidromeShareInfo={null}
      navidromeShareResolving={false}
      navidromeShareError={null}
    />,
  );
}

describe('ShareSearchResults playlist shares', () => {
  it.each(['desktop', 'mobile'] as const)('opens the resolved playlist in the %s result', async variant => {
    const onOpenPlaylist = vi.fn();
    const user = userEvent.setup();
    renderPlaylistResult(variant, onOpenPlaylist);

    await user.click(screen.getByRole(variant === 'desktop' ? 'option' : 'button', {
      name: /Shared Playlist/i,
    }));

    expect(screen.getByText('3 Songs')).toBeInTheDocument();
    expect(onOpenPlaylist).toHaveBeenCalledOnce();
  });
});
