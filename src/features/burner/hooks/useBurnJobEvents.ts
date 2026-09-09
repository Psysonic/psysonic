import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import i18n from '@/lib/i18n';
import { showToast } from '@/lib/dom/toast';
import { useBurnJobStore } from '@/features/burner/store/burnJobStore';
import type { BurnCompleteEvent, BurnProgressEvent } from '@/lib/api/burn';

/**
 * Bridges `burn:progress` / `burn:complete` into the burn job store.
 *
 * Mounted once from `TauriEventBridge`, not from the Burner page, so a burn
 * keeps reporting while the user browses elsewhere — burning a disc takes
 * minutes and nobody should have to sit on the page to keep it alive.
 */
export function useBurnJobEvents(): void {
  useEffect(() => {
    const unlistenProgress = listen<BurnProgressEvent>('burn:progress', ({ payload }) => {
      useBurnJobStore.getState().applyProgress(payload);
    });

    const unlistenComplete = listen<BurnCompleteEvent>('burn:complete', ({ payload }) => {
      const store = useBurnJobStore.getState();
      if (store.jobId !== payload.jobId) return;

      if (payload.cancelled) {
        store.finishCancelled();
        showToast(i18n.t('burner.toastCancelled'), 5000, 'info');
        return;
      }
      if (payload.error) {
        store.fail(payload.error);
        showToast(payload.error, 8000, 'error');
        return;
      }

      store.finish({
        tracksWritten: payload.tracksWritten,
        sectorsWritten: payload.sectorsWritten,
      });

      if (payload.testWrite) {
        showToast(i18n.t('burner.toastTestWriteDone'), 6000, 'info');
        return;
      }

      showToast(i18n.t('burner.toastBurnDone', { count: payload.tracksWritten }), 6000, 'info');

      // CD-TEXT is read back rather than trusted — but "the drive would not
      // answer" and "the disc has none" are different answers and must not be
      // reported as the same failure.
      const check = payload.cdTextVerification;
      if (payload.cdTextWritten && check) {
        if (!check.checked) {
          showToast(i18n.t('burner.toastCdTextUnreadable'), 9000, 'info');
        } else if (check.packs > 0) {
          showToast(i18n.t('burner.toastCdTextVerified', { count: check.packs }), 6000, 'info');
        } else {
          showToast(i18n.t('burner.toastCdTextUnconfirmed'), 10000, 'info');
        }
      }
    });

    return () => {
      void unlistenProgress.then(fn => fn());
      void unlistenComplete.then(fn => fn());
    };
  }, []);
}
