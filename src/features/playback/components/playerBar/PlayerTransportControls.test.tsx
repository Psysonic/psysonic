import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import i18n from '@/lib/i18n';
import { PlayerTransportControls } from './PlayerTransportControls';

const albumSkip = vi.hoisted(() => ({
  skipToNextAlbum: vi.fn(),
  skipToPreviousAlbum: vi.fn(),
}));

vi.mock('@/features/playback/store/albumSkip', () => albumSkip);

const next = vi.fn();
const previous = vi.fn();

function renderControls() {
  return renderWithProviders(
    <PlayerTransportControls
      isPlaying
      isRadio={false}
      isPreviewing={false}
      stop={vi.fn()}
      previous={previous}
      next={next}
      toggleRepeat={vi.fn()}
      repeatMode="off"
      toggleShuffleMode={vi.fn()}
      shuffleMode={false}
      playPauseBind={{ onClick: vi.fn() } as never}
      scheduleRemaining={null}
      transportAnchorRef={createRef<HTMLDivElement>()}
      playSlotRef={createRef<HTMLSpanElement>()}
      t={i18n.t}
    />,
  );
}

beforeEach(() => {
  resetAllStores();
  next.mockClear();
  previous.mockClear();
  albumSkip.skipToNextAlbum.mockClear();
  albumSkip.skipToPreviousAlbum.mockClear();
});

describe('PlayerTransportControls album skip', () => {
  it('skips a track on a plain click and an album on Alt+click', () => {
    const { getByRole } = renderControls();
    const nextButton = getByRole('button', { name: 'Next Track' });
    const prevButton = getByRole('button', { name: 'Previous Track' });

    fireEvent.click(nextButton);
    fireEvent.click(prevButton);
    expect(next).toHaveBeenCalledOnce();
    expect(previous).toHaveBeenCalledOnce();
    expect(albumSkip.skipToNextAlbum).not.toHaveBeenCalled();

    fireEvent.click(nextButton, { altKey: true });
    fireEvent.click(prevButton, { altKey: true });
    expect(albumSkip.skipToNextAlbum).toHaveBeenCalledOnce();
    expect(albumSkip.skipToPreviousAlbum).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect(previous).toHaveBeenCalledOnce();
  });

  it('names the Alt+click album jump in the tooltip', () => {
    const { getByRole } = renderControls();
    expect(getByRole('button', { name: 'Next Track' }).getAttribute('data-tooltip'))
      .toBe('Next Track · Alt+click: next album');
    expect(getByRole('button', { name: 'Previous Track' }).getAttribute('data-tooltip'))
      .toBe('Previous Track · Alt+click: previous album');
  });
});
