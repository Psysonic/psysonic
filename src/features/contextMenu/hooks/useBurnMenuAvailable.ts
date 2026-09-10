/**
 * Whether "Add to CD" belongs in a context menu right now.
 *
 * Two gates, for two different dead ends:
 *
 *  * **Platform.** On a build with no burn backend the item queues tracks onto
 *    a page that can only apologise, and the user can do nothing about it.
 *  * **The sidebar entry.** The burner ships hidden (`sidebarStore`), so
 *    without this gate a fresh install offers "Add to CD" in every song menu
 *    while `/burn` is unreachable from the sidebar. Gating on visibility means
 *    the page is always one click away wherever the item appears.
 *
 * The second overloads a sidebar-visibility toggle into a feature switch,
 * which is not what it means for the other nav entries. It earns the exception
 * by being the only one gated on hardware most machines no longer have: the
 * toggle is the closest thing to "I have a drive" without enumerating drives
 * at startup.
 *
 * `busy` is deliberately not a third gate. A burn in progress is a temporary
 * refusal with a reason, and hiding the item mid-burn would make it vanish
 * from a menu the user had just used — so it is reported separately and the
 * callers render the item disabled instead of dropping it.
 */
import { useEffect } from 'react';
import { burnJobIsActive, primeBurnSupport, useBurnJobStore, useBurnSupportStore } from '@/features/burner';
import type { OfflineActionPolicy } from '@/features/offline';
import { useSidebarStore } from '@/features/sidebar';

/** Nav id of the burner entry, as `DEFAULT_SIDEBAR_ITEMS` spells it. */
const BURNER_NAV_ID = 'burner';

/** What the menu needs to know: whether to offer the item, and whether it bites. */
export interface BurnMenuState {
  /** Show the item at all. */
  available: boolean;
  /** A job owns the queue right now, so the item is shown but inert. */
  busy: boolean;
}

export function useBurnMenuAvailable(offlinePolicy: OfflineActionPolicy): BurnMenuState {
  const support = useBurnSupportStore(s => s.supported);
  const navVisible = useSidebarStore(
    s => s.items.find(item => item.id === BURNER_NAV_ID)?.visible ?? false,
  );
  // Selected down to a boolean rather than read as a whole store: the job
  // store ticks on every progress event, and this menu only cares whether the
  // drive is running.
  const busy = useBurnJobStore(s => burnJobIsActive(s.status));

  useEffect(() => {
    primeBurnSupport();
  }, []);

  // `canAddToPlaylist` is borrowed, not incidental: it is the policy's
  // "server-mutating actions are allowed" flag, and a burn fetches anything
  // not already cached. Offline-mode burning of already-cached tracks is a
  // separate question from this one.
  return {
    available: support === 'yes' && navVisible && offlinePolicy.canAddToPlaylist,
    busy,
  };
}
