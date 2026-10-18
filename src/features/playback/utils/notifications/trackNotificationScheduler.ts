import { commands } from '@/generated/bindings';
import { useAuthStore } from '@/store/authStore';
import type { TrackNotificationContent } from './trackNotificationContent';

/**
 * A track has to stay current this long before it is announced, so skipping
 * through a queue announces only the track playback settles on.
 */
export const TRACK_NOTIFICATION_SETTLE_MS = 1000;

export interface TrackNotificationRequest extends TrackNotificationContent {
  coverPath: string | null;
}

interface TrackNotificationSchedulerDeps {
  settleMs: number;
  isEnabled: () => boolean;
  show: (request: TrackNotificationRequest) => Promise<unknown>;
}

export interface TrackNotificationScheduler {
  /**
   * Announces `key` once it is still current after the settle time. `build`
   * runs only then; `isCurrent` is asked again after it, since resolving the
   * cover takes a moment. The same key is never announced twice in a row.
   */
  announce: (
    key: string,
    build: () => Promise<TrackNotificationRequest | null>,
    isCurrent: () => boolean,
  ) => void;
  dispose: () => void;
}

export function createTrackNotificationScheduler(
  deps: TrackNotificationSchedulerDeps,
): TrackNotificationScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastAnnounced: string | null = null;

  const clear = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    announce(key, build, isCurrent) {
      clear();
      if (!deps.isEnabled() || key === lastAnnounced) return;
      timer = setTimeout(() => {
        timer = null;
        if (!deps.isEnabled() || !isCurrent()) return;
        lastAnnounced = key;
        void build()
          .then(request => (request && isCurrent() ? deps.show(request) : undefined))
          .catch(() => {});
      }, deps.settleMs);
    },
    dispose: clear,
  };
}

/** Shared by the track and the radio path, so one change never announces twice. */
export const trackNotificationScheduler = createTrackNotificationScheduler({
  settleMs: TRACK_NOTIFICATION_SETTLE_MS,
  isEnabled: () => useAuthStore.getState().trackChangeNotificationsEnabled,
  show: async ({ title, body, coverPath }) => {
    const res = await commands.showTrackNotification(title, body, coverPath);
    if (res.status === 'error') throw new Error(res.error);
  },
});
