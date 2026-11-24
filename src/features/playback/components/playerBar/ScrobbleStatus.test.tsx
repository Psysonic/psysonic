import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { makeTrack, seedQueue } from '@/test/helpers/factories';
import { resetAllStores } from '@/test/helpers/storeReset';
import { emitPlaybackProgress } from '@/features/playback/store/playbackProgress';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { usePreviewStore } from '@/features/playback/store/previewStore';
import { useAuthStore } from '@/store/authStore';
import { usePrivateModeStore } from '@/features/privateMode';
import type { PersistedAccount } from '@/music-network/core/accounts';
import i18n from '@/lib/i18n';
import { ScrobbleActionButton, ScrobbleMenuSection } from './ScrobbleStatus';

const forceScrobbleCurrentTrack = vi.hoisted(() => vi.fn(() => true));
const useOfflineBrowseStatus = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/features/playback/store/scrobbleActions', () => ({
  forceScrobbleCurrentTrack,
}));

vi.mock('@/features/offline', () => ({
  useOfflineBrowseStatus,
  offlineActionPolicy: (_surface: string, offline: boolean) => ({ canScrobble: !offline }),
}));

const account = (over: Partial<PersistedAccount> = {}): PersistedAccount => ({
  id: 'acc-1', presetId: 'lastfm', wireId: 'audioscrobbler_v2', label: 'Last.fm',
  baseUrl: '', scrobbleEnabled: true, sessionKey: 'sk', username: 'tester',
  apiKey: 'k', apiSecret: 's', sessionError: false, capabilities: {},
  ...over,
});

function withPrimary(over: Partial<PersistedAccount> = {}) {
  useAuthStore.setState({ musicNetworkAccounts: [account(over)], enrichmentPrimaryId: 'acc-1' });
}

/** Shows where the router went, so a test can check the settings link. */
function Where() {
  const location = useLocation();
  const tab = (location.state as { tab?: string } | null)?.tab ?? '';
  return <div data-testid="where">{`${location.pathname}#${tab}`}</div>;
}

function renderButton() {
  return renderWithProviders(
    <Routes>
      <Route path="*" element={<><ScrobbleActionButton t={i18n.t} className="player-btn" /><Where /></>} />
    </Routes>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAllStores();
  forceScrobbleCurrentTrack.mockClear();
  useOfflineBrowseStatus.mockReturnValue(false);
  const track = makeTrack({ duration: 100 });
  seedQueue([track], { index: 0, currentTrack: track });
  usePlayerStore.setState({ scrobbled: false });
  useAuthStore.setState({ scrobbleThresholdPercent: 50 });
  emitPlaybackProgress({ currentTime: 20, progress: 0.2, buffered: 0, buffering: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ScrobbleActionButton', () => {
  it('is shown without any setting', () => {
    const { getByRole } = renderButton();
    expect(getByRole('button', { name: 'Force scrobble' })).toBeInTheDocument();
  });

  it('uses the radio tower before submission and BadgeCheck afterward', () => {
    const { container } = renderButton();
    expect(container.querySelector('.player-btn .lucide-radio-tower')).toBeInTheDocument();

    act(() => usePlayerStore.setState({ scrobbled: true }));
    expect(container.querySelector('.lucide-badge-check')).toBeInTheDocument();
  });

  it('opens on click, shows progress, and force-scrobbles the current track', () => {
    const { getByRole } = renderButton();

    fireEvent.click(getByRole('button', { name: 'Force scrobble' }));
    const dialog = getByRole('dialog', { name: 'Scrobble status' });
    expect(dialog).toHaveTextContent('20% of 50%');
    expect(dialog.querySelector<HTMLElement>('.player-scrobble-popover__bar-fill')!.style.width).toBe('20%');
    expect(dialog.querySelector<HTMLElement>('.player-scrobble-popover__bar-mark')!.style.left).toBe('50%');

    fireEvent.click(dialog.querySelector('.player-scrobble-popover__force')!);
    expect(forceScrobbleCurrentTrack).toHaveBeenCalledWith(true);
  });

  it('starts on Force scrobble, keeps Tab inside the menu and restores focus on Escape', () => {
    const { getByRole } = renderButton();
    const trigger = getByRole('button', { name: 'Force scrobble' });

    fireEvent.click(trigger);
    const dialog = getByRole('dialog', { name: 'Scrobble status' });
    const forceButton = dialog.querySelector<HTMLElement>('.player-scrobble-popover__force')!;
    const privateSwitch = dialog.querySelector<HTMLElement>('input[type="checkbox"]')!;
    expect(forceButton).toHaveFocus();

    fireEvent.keyDown(forceButton, { key: 'Tab' });
    expect(privateSwitch).toHaveFocus();
    fireEvent.keyDown(privateSwitch, { key: 'Tab', shiftKey: true });
    expect(forceButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('explains why force scrobble is unavailable offline', () => {
    useOfflineBrowseStatus.mockReturnValue(true);
    const { getByRole, queryByRole, getByText } = renderButton();
    fireEvent.click(getByRole('button', { name: 'Unavailable while offline' }));
    expect(queryByRole('button', { name: 'Force scrobble' })).toBeNull();
    expect(getByText('Unavailable while offline')).toHaveFocus();
  });

  it('uses localized preview copy instead of exposing the translation key', () => {
    usePreviewStore.setState({ previewingId: 'preview-track' });
    const { getByRole, getByText } = renderButton();

    fireEvent.click(getByRole('button', { name: 'Unavailable during track preview' }));
    expect(getByText('Unavailable during track preview')).toHaveFocus();
  });
});

describe('scrobble menu: private mode', () => {
  it('switches private mode on from the menu and shows the mask on the button', () => {
    const { getByRole, container } = renderButton();
    fireEvent.click(getByRole('button', { name: 'Force scrobble' }));

    fireEvent.click(getByRole('checkbox', { name: 'Private mode' }));
    expect(usePrivateModeStore.getState().active).toBe(true);
    expect(container.querySelector('.player-btn .lucide-venetian-mask')).toBeInTheDocument();
  });

  it('hides progress and force scrobble while private mode is on', () => {
    usePrivateModeStore.setState({ active: true });
    const { getByRole } = renderButton();
    fireEvent.click(getByRole('button', { name: 'Private mode is on — nothing is scrobbled' }));

    const dialog = getByRole('dialog', { name: 'Scrobble status' });
    expect(dialog.querySelector('.player-scrobble-popover__force')).toBeNull();
    expect(dialog).not.toHaveTextContent('20% of 50%');
    expect(getByRole('checkbox', { name: 'Private mode' })).toBeChecked();
  });
});

describe('scrobble menu: account', () => {
  it('shows no account row without a music-network account', () => {
    const { getByRole } = renderButton();
    fireEvent.click(getByRole('button', { name: 'Force scrobble' }));
    expect(getByRole('dialog').querySelector('.player-scrobble-popover__account')).toBeNull();
  });

  it('names the account and opens its settings', () => {
    withPrimary();
    const { getByRole, getByTestId, queryByRole } = renderButton();
    fireEvent.click(getByRole('button', { name: 'Force scrobble' }));

    const row = getByRole('button', { name: /Last\.fm, @tester\. Open in settings/ });
    fireEvent.click(row);
    expect(getByTestId('where')).toHaveTextContent('/settings#integrations');
    expect(queryByRole('dialog')).toBeNull();
  });

  it('flags a sign-in problem with a red dot and says so', () => {
    withPrimary({ sessionError: true });
    const { getByRole, container } = renderButton();
    const trigger = getByRole('button', { name: 'Reconnect needed' });
    expect(container.querySelector('.player-scrobble-btn__alert')).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(getByRole('dialog')).toHaveTextContent('Reconnect needed');
  });
});

describe('ScrobbleMenuSection (compact overflow menu)', () => {
  it('shows the same menu inline and closes the overflow menu after a force scrobble', () => {
    const onDone = vi.fn();
    const { container, getByRole, queryByRole } = renderWithProviders(
      <ScrobbleMenuSection t={i18n.t} onDone={onDone} />,
    );
    expect(queryByRole('dialog')).toBeNull();
    expect(getByRole('checkbox', { name: 'Private mode' })).toBeInTheDocument();

    fireEvent.click(container.querySelector('.player-scrobble-popover__force')!);
    expect(forceScrobbleCurrentTrack).toHaveBeenCalledWith(true);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('does not force-scrobble while blocked, and leaves the menu open', () => {
    useOfflineBrowseStatus.mockReturnValue(true);
    const onDone = vi.fn();
    const { container, getByText } = renderWithProviders(
      <ScrobbleMenuSection t={i18n.t} onDone={onDone} />,
    );
    expect(container.querySelector('.player-scrobble-popover__force')).toBeNull();
    expect(getByText('Unavailable while offline')).toBeInTheDocument();
    expect(forceScrobbleCurrentTrack).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
