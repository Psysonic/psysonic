import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeTrack, seedQueue } from '@/test/helpers/factories';
import { resetAllStores } from '@/test/helpers/storeReset';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { _resetScheduleTimersForTest } from '@/features/playback/store/scheduleTimers';
import PlaybackDelayModal from './PlaybackDelayModal';

beforeEach(() => {
  vi.useFakeTimers();
  resetAllStores();
  _resetScheduleTimersForTest();
});

afterEach(() => {
  _resetScheduleTimersForTest();
  vi.useRealTimers();
});

function playing(track = makeTrack({ albumId: 'album-a', duration: 200 })): void {
  seedQueue([track, makeTrack({ albumId: 'album-b' })], { index: 0 });
  usePlayerStore.setState({ isPlaying: true });
}

describe('PlaybackDelayModal — end of track or album', () => {
  it('arms the album end and closes', () => {
    playing();
    const onClose = vi.fn();
    const { getByRole } = renderWithProviders(<PlaybackDelayModal open onClose={onClose} />);

    fireEvent.click(getByRole('button', { name: 'End of album' }));
    expect(usePlayerStore.getState().scheduledPauseBoundary).toBe('album');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('marks the armed choice and names it next to the countdown', () => {
    playing();
    usePlayerStore.setState({
      scheduledPauseBoundary: 'track',
      scheduledPauseAtMs: Date.now() + 60_000,
      scheduledPauseStartMs: Date.now(),
    });
    const { getByRole, getByText } = renderWithProviders(<PlaybackDelayModal open onClose={vi.fn()} />);

    expect(getByRole('button', { name: 'End of track' })).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole('button', { name: 'End of album' })).toHaveAttribute('aria-pressed', 'false');
    expect(getByText(/End of track · in/)).toBeInTheDocument();
  });

  it('offers no album end for a track without an album', () => {
    playing(makeTrack({ albumId: '' }));
    const { getByRole, queryByRole } = renderWithProviders(<PlaybackDelayModal open onClose={vi.fn()} />);
    expect(getByRole('button', { name: 'End of track' })).toBeInTheDocument();
    expect(queryByRole('button', { name: 'End of album' })).toBeNull();
  });

  it('offers neither for a radio stream', () => {
    playing();
    usePlayerStore.setState({
      currentTrack: null,
      currentRadio: { id: 'r', name: 'Radio', streamUrl: 'http://x' } as never,
    });
    const { queryByRole } = renderWithProviders(<PlaybackDelayModal open onClose={vi.fn()} />);
    expect(queryByRole('button', { name: 'End of track' })).toBeNull();
    expect(queryByRole('button', { name: 'End of album' })).toBeNull();
  });
});
