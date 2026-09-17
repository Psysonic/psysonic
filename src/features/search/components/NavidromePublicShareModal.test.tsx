import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { open } from '@tauri-apps/plugin-shell';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import NavidromePublicShareModal from '@/features/search/components/NavidromePublicShareModal';

const shareRef = {
  pageUrl: 'https://music.test/share/AbCdEfGhIj',
  origin: 'https://music.test',
  basePath: '',
  shareId: 'AbCdEfGhIj',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NavidromePublicShareModal', () => {
  it('uses the ND Shares content viewer layout for a resolved public share', () => {
    const onPlay = vi.fn();
    renderWithProviders(
      <NavidromePublicShareModal
        open
        onClose={vi.fn()}
        publicShareRef={shareRef}
        preview={{
          navidromeShareInfo: {
            id: 'share-1',
            description: 'Road trip',
            downloadable: true,
            imageUrl: 'https://music.test/share/img/token',
            tracks: [
              { id: 'track-1', title: 'First track', artist: 'Artist', album: 'Album', duration: 61 },
              { id: 'track-2', title: 'Second track', artist: 'Artist', album: 'Album', duration: 122 },
            ],
          },
          navidromeShareResolving: false,
          navidromeShareError: null,
        }}
        hostLabel="Home server"
        onPlay={onPlay}
        playBusy={false}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Road trip' });
    expect(dialog).toHaveClass('ui-modal', 'ui-modal--lg');
    expect(within(dialog).getByText('From Home server · 2 items')).toBeInTheDocument();
    expect(within(dialog).getByText('First track')).toBeInTheDocument();
    expect(within(dialog).getByText('1:01')).toBeInTheDocument();
    expect(dialog.querySelectorAll('.shared-contents-modal__cover')).toHaveLength(2);
    expect(document.querySelector('.share-queue-preview-modal')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Play share' }));
    expect(onPlay).toHaveBeenCalledOnce();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open in browser' }));
    expect(open).toHaveBeenCalledWith(shareRef.pageUrl);
  });
});
