/**
 * The info tab's Bandsintown opt-in prompt can be declined for good.
 *
 * The prompt is how the feature is discovered, so it stays in place — but an
 * "optional" prompt the user cannot say no to is the complaint behind #1510.
 * Declining hides it permanently and points at Settings → Integrations, which
 * remains the way to turn the feature on later.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import NowPlayingInfo from '@/features/nowPlaying/components/NowPlayingInfo';

vi.mock('@/lib/api/subsonicArtists', () => ({
  getArtistInfoForServer: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/api/subsonicLibrary', () => ({
  getSongForServer: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/api/bandsintown', () => ({
  fetchBandsintownEvents: vi.fn().mockResolvedValue([]),
}));

const showToast = vi.hoisted(() => vi.fn());
vi.mock('@/lib/dom/toast', () => ({ showToast }));

const PROMPT = '.np-info-bandsintown-prompt';
const DISMISS = '.np-info-bandsintown-prompt-dismiss';

beforeEach(() => {
  resetAuthStore();
  showToast.mockClear();
  usePlayerStore.setState({
    currentTrack: { id: 't1', title: 'Song', artist: 'Artist' },
  } as never);
});

describe('Bandsintown opt-in prompt', () => {
  it('is shown while the feature is off and was never declined', () => {
    const { container } = renderWithProviders(<NowPlayingInfo />);
    expect(container.querySelector(PROMPT)).not.toBeNull();
    expect(container.querySelector(DISMISS)).not.toBeNull();
  });

  it('declining hides it, remembers the choice, and names the way back', () => {
    const { container } = renderWithProviders(<NowPlayingInfo />);

    fireEvent.click(container.querySelector(DISMISS)!);

    expect(container.querySelector(PROMPT)).toBeNull();
    expect(useAuthStore.getState().bandsintownPromptDismissed).toBe(true);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('stays hidden on a later mount', () => {
    useAuthStore.getState().setBandsintownPromptDismissed(true);
    const { container } = renderWithProviders(<NowPlayingInfo />);
    expect(container.querySelector(PROMPT)).toBeNull();
  });

  it('does not suppress the tour list once the feature is enabled', () => {
    // Declining the prompt must not read as "never show tour dates": the
    // Settings toggle stays authoritative for the feature itself.
    useAuthStore.getState().setBandsintownPromptDismissed(true);
    useAuthStore.getState().setEnableBandsintown(true);
    const { container } = renderWithProviders(<NowPlayingInfo />);
    expect(container.querySelector(PROMPT)).toBeNull();
    expect(container.textContent).toContain('On tour');
  });
});
