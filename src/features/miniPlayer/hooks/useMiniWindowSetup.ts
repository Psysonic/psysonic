import { useEffect } from 'react';
import { setLinuxWebkitSmoothScrolling } from '@/lib/api/platformShell';
import {
  resizeMiniPlayer, setMiniPlayerAlwaysOnTop, setMiniPlayerDecorations,
} from '@/lib/api/miniPlayer';
import { useAuthStore } from '@/store/authStore';
import { IS_LINUX, IS_WINDOWS } from '@/lib/util/platform';
import {
  EXPANDED_SIZE, EXPANDED_MIN, readStoredExpandedHeight,
} from '@/features/miniPlayer/utils/miniPlayerHelpers';

/** Three window-bound setup effects bundled together:
 *  - Linux WebKitGTK smooth-scroll per-window (re-applies after auth hydrates
 *    so preloaded/hidden mini matches the Settings toggle).
 *  - Initial expanded-size restore: Rust always builds the window at the
 *    collapsed size, so on cold start with queueOpen=true we resize once.
 *  - Always-on-top reapply on mount and on focus: WMs silently drop the
 *    constraint after Hide/Show cycles, so we re-assert it whenever the user
 *    actually brings the window to the foreground. */
export function useMiniWindowSetup(alwaysOnTop: boolean, initialQueueOpen: boolean) {
  const miniPlayerCustomTitlebar = useAuthStore(s => s.miniPlayerCustomTitlebar);

  useEffect(() => {
    if (!IS_LINUX) return;
    const apply = () => {
      setLinuxWebkitSmoothScrolling({
        enabled: useAuthStore.getState().linuxWebkitKineticScroll,
      }).catch(() => {});
    };
    apply();
    return useAuthStore.persist.onFinishHydration(() => {
      apply();
    });
  }, []);

  // Windows only: the frame the user chose. The window is built once — before
  // this webview mounts — so the frame is switched on the live window rather
  // than at build time. Subscribing to the value rather than reading it once
  // covers all three moments it can arrive: mount, the persisted store
  // finishing its read, and the user flipping the setting in the main window.
  useEffect(() => {
    if (!IS_WINDOWS) return;
    setMiniPlayerDecorations({ decorations: !miniPlayerCustomTitlebar }).catch(() => {});
  }, [miniPlayerCustomTitlebar]);

  useEffect(() => {
    if (!initialQueueOpen) return;
    resizeMiniPlayer({
      width: EXPANDED_SIZE.w,
      height: readStoredExpandedHeight(),
      minWidth: EXPANDED_MIN.w,
      minHeight: EXPANDED_MIN.h,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMiniPlayerAlwaysOnTop({ onTop: alwaysOnTop }).catch(() => {});
    const reapply = () => {
      if (alwaysOnTop) {
        setMiniPlayerAlwaysOnTop({ onTop: true }).catch(() => {});
      }
    };
    window.addEventListener('focus', reapply);
    return () => window.removeEventListener('focus', reapply);
  }, [alwaysOnTop]);
}
