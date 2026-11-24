import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import type { TFunction } from 'i18next';
import { BadgeCheck, ChevronRight, RadioTower, SendHorizontal, VenetianMask } from 'lucide-react';
import { offlineActionPolicy, useOfflineBrowseStatus } from '@/features/offline';
import { usePrivateModeStore } from '@/features/privateMode';
import { usePlayerBarAnchoredPopover } from '@/features/playback/hooks/usePlayerBarAnchoredPopover';
import {
  getPlaybackProgressSnapshot,
  subscribePlaybackProgress,
} from '@/features/playback/store/playbackProgress';
import { forceScrobbleCurrentTrack } from '@/features/playback/store/scrobbleActions';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { usePreviewStore } from '@/features/playback/store/previewStore';
import { renderPresetIcon, useEnrichmentPrimary } from '@/music-network/ui';
import { useAuthStore } from '@/store/authStore';

const POPOVER_WIDTH = 280;

function useScrobbleStatusState(t: TFunction, trackProgress: boolean) {
  const [heardPercent, setHeardPercent] = useState(() =>
    Math.round(getPlaybackProgressSnapshot().progress * 100),
  );
  const scrobbled = usePlayerStore(s => s.scrobbled);
  const hasTrack = usePlayerStore(s => s.currentTrack != null);
  const hasRadio = usePlayerStore(s => s.currentRadio != null);
  const previewing = usePreviewStore(s => s.previewingId != null);
  const privateMode = usePrivateModeStore(s => s.active);
  const threshold = useAuthStore(s => s.scrobbleThresholdPercent);
  // Passive: the app shell already probes the server; this button must not add a probe of its own.
  const offline = useOfflineBrowseStatus();
  const canScrobble = offlineActionPolicy('playerBar', offline).canScrobble;

  useEffect(() => {
    if (!trackProgress) return;
    const sync = () => setHeardPercent(Math.round(getPlaybackProgressSnapshot().progress * 100));
    sync();
    return subscribePlaybackProgress(sync);
  }, [trackProgress]);

  const blockedReason = hasRadio
    ? t('player.scrobbleRadio')
    : !hasTrack
      ? t('player.scrobbleUnavailable')
      : previewing
        ? t('player.scrobblePreview')
        : !canScrobble
          ? t('player.scrobbleOffline')
          : scrobbled
            ? t('player.scrobbleAlreadySent')
            : privateMode
              ? t('player.scrobblePrivate')
              : null;

  return {
    heardPercent,
    threshold,
    scrobbled,
    blockedReason,
    canScrobble,
    privateMode,
  };
}

/** The music-network account the app scrobbles and loves with (what the top bar used to show). */
function ScrobbleAccountRow({ t, onOpenSettings }: { t: TFunction; onOpenSettings: () => void }) {
  const primary = useEnrichmentPrimary();
  if (!primary) return null;
  const { account, label, icon } = primary;
  const detail = account.sessionError
    ? t('musicNetwork.statusError')
    : account.username
      ? `@${account.username}`
      : t('musicNetwork.statusConnected');

  return (
    <button
      type="button"
      className={`player-scrobble-popover__account${account.sessionError ? ' player-scrobble-popover__account--error' : ''}`}
      onClick={onOpenSettings}
      aria-label={`${label}, ${detail}. ${t('player.scrobbleAccountSettings')}`}
    >
      <span
        className={`connection-led connection-led--${account.sessionError ? 'disconnected' : 'connected'}`}
        aria-hidden
      />
      <span className="player-scrobble-popover__account-text">
        <span className="player-scrobble-popover__account-name">
          {renderPresetIcon(icon, 12)}
          {label}
        </span>
        <span className="player-scrobble-popover__hint">{detail}</span>
      </span>
      <ChevronRight size={14} aria-hidden />
    </button>
  );
}

/** Private mode switch (it used to sit on its own in the top bar). */
function PrivateModeRow({ t }: { t: TFunction }) {
  const active = usePrivateModeStore(s => s.active);
  const toggle = usePrivateModeStore(s => s.toggle);
  return (
    <div className="player-scrobble-popover__private">
      <VenetianMask size={14} aria-hidden />
      <span className="player-scrobble-popover__private-text">
        <span>{t('privateMode.label')}</span>
        <span className="player-scrobble-popover__hint">{t('privateMode.hint')}</span>
      </span>
      <label className="toggle-switch" aria-label={t('privateMode.label')}>
        <input type="checkbox" checked={active} onChange={toggle} />
        <span className="toggle-track" />
      </label>
    </div>
  );
}

/**
 * Everything about scrobbling in one place: the account, private mode, how much of the track is
 * heard and the force-scrobble button (or why it is unavailable). Used by the player-bar popover
 * and, inline, by the compact overflow menu.
 */
function ScrobbleMenuContent({
  t,
  forceButtonRef,
  blockedStatusRef,
  onForce,
  onOpenSettings,
}: {
  t: TFunction;
  forceButtonRef?: React.RefObject<HTMLButtonElement | null>;
  blockedStatusRef?: React.RefObject<HTMLDivElement | null>;
  onForce: () => void;
  onOpenSettings: () => void;
}) {
  const { heardPercent, threshold, blockedReason, privateMode } = useScrobbleStatusState(t, true);
  return (
    <>
      <ScrobbleAccountRow t={t} onOpenSettings={onOpenSettings} />
      <PrivateModeRow t={t} />
      {/* In private mode nothing is sent, so progress and force scrobble have nothing to say. */}
      {!privateMode && (
        <div className="player-scrobble-popover__section">
          <div className="player-scrobble-popover__progress">
            {t('player.scrobbleProgress', { current: heardPercent, threshold })}
          </div>
          {/* Heard so far, with a mark where the automatic scrobble happens. */}
          <div className="player-scrobble-popover__bar" aria-hidden>
            <span
              className="player-scrobble-popover__bar-fill"
              style={{ width: `${Math.min(100, Math.max(0, heardPercent))}%` }}
            />
            <span
              className="player-scrobble-popover__bar-mark"
              style={{ left: `${Math.min(100, Math.max(0, threshold))}%` }}
            />
          </div>
          {blockedReason == null ? (
            <button
              ref={forceButtonRef}
              type="button"
              className="player-scrobble-popover__force"
              onClick={onForce}
            >
              <SendHorizontal size={14} aria-hidden />
              {t('player.forceScrobble')}
            </button>
          ) : (
            <div
              ref={blockedStatusRef}
              className="player-scrobble-popover__blocked"
              tabIndex={-1}
            >
              {blockedReason}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function useOpenScrobbleSettings(after?: () => void) {
  const navigate = useNavigate();
  return () => {
    navigate('/settings', { state: { tab: 'integrations' } });
    after?.();
  };
}

/** Buttons, links and the switch inside `root`, for the popover's Tab loop. */
function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('button, input, [tabindex="-1"]')].filter(
    el => !el.hasAttribute('disabled'),
  );
}

interface ScrobbleActionButtonProps {
  t: TFunction;
  className: string;
  activeClassName?: string;
  iconSize?: number;
}

/**
 * The scrobble button: its icon shows the state (sent, private mode), a red dot flags a
 * music-network sign-in problem, and a click opens the scrobble menu.
 */
export function ScrobbleActionButton({
  t,
  className,
  activeClassName = 'active',
  iconSize = 15,
}: ScrobbleActionButtonProps) {
  const { open, setOpen, toggleOpen, popStyle, btnRef, popRef } =
    usePlayerBarAnchoredPopover(POPOVER_WIDTH);
  const forceButtonRef = useRef<HTMLButtonElement>(null);
  const blockedStatusRef = useRef<HTMLDivElement>(null);
  const { scrobbled, blockedReason, canScrobble, privateMode } = useScrobbleStatusState(t, false);
  const sessionError = useEnrichmentPrimary()?.account.sessionError === true;
  const Icon = privateMode ? VenetianMask : scrobbled ? BadgeCheck : RadioTower;
  const tooltip = sessionError
    ? t('musicNetwork.statusError')
    : blockedReason ?? (scrobbled ? t('player.scrobbleAlreadySent') : t('player.forceScrobble'));

  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };
  const openSettings = useOpenScrobbleSettings(() => setOpen(false));

  useEffect(() => {
    if (open) (forceButtonRef.current ?? blockedStatusRef.current ?? focusablesIn(popRef.current)[0])?.focus();
  }, [blockedReason, open, popRef]);

  const force = () => {
    if (blockedReason == null) forceScrobbleCurrentTrack(canScrobble);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${className}${scrobbled || privateMode ? ` ${activeClassName}` : ''}${sessionError ? ' player-scrobble-btn--alert' : ''}`}
        onClick={toggleOpen}
        aria-label={tooltip}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tooltip={open ? undefined : tooltip}
      >
        <Icon size={iconSize} aria-hidden />
        {sessionError && <span className="player-scrobble-btn__alert" aria-hidden />}
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className="player-scrobble-popover"
          role="dialog"
          aria-label={t('player.scrobbleStatus')}
          style={popStyle}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            // Keep Tab inside the menu: cycle through its controls.
            const items = focusablesIn(popRef.current);
            if (items.length === 0) return;
            event.preventDefault();
            const at = items.indexOf(document.activeElement as HTMLElement);
            const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length;
            items[next].focus();
          }}
        >
          <ScrobbleMenuContent
            t={t}
            forceButtonRef={forceButtonRef}
            blockedStatusRef={blockedStatusRef}
            onForce={() => {
              force();
              close();
            }}
            onOpenSettings={openSettings}
          />
        </div>,
        document.body,
      )}
    </>
  );
}

/** The scrobble menu as a section of the compact player-bar overflow menu (no nested popover). */
export function ScrobbleMenuSection({ t, onDone }: { t: TFunction; onDone: () => void }) {
  const { blockedReason, canScrobble } = useScrobbleStatusState(t, false);
  const openSettings = useOpenScrobbleSettings(onDone);
  return (
    <div className="player-scrobble-popover player-scrobble-popover--inline">
      <ScrobbleMenuContent
        t={t}
        onForce={() => {
          if (blockedReason == null) forceScrobbleCurrentTrack(canScrobble);
          onDone();
        }}
        onOpenSettings={openSettings}
      />
    </div>
  );
}
