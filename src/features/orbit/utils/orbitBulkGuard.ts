import { useOrbitStore } from '@/features/orbit/store/orbitStore';
import { useConfirmModalStore } from '@/store/confirmModalStore';
import i18n from '@/lib/i18n';
import { registerOrbitRuntime } from '@/store/orbitRuntime';
import { orbitActionServerMatches } from '@/features/orbit/utils/orbitServerScope';
import { useAuthStore } from '@/store/authStore';
import { suggestOrbitTracks } from '@/features/orbit/utils/guest';

/**
 * Ask the user before dropping many tracks into the shared Orbit queue.
 *
 * Returns `true` when there's no active Orbit session, when `count <= 1`, or
 * when the user accepted the confirm dialog. Returns `false` only when an
 * active-Orbit user explicitly cancelled.
 *
 * The audio core reaches this (and the orbit session snapshot) through the
 * neutral `@/store/orbitRuntime` seam, not by importing the orbit feature.
 */
export async function orbitBulkGuard(count: number): Promise<boolean> {
  const role = useOrbitStore.getState().role;
  if (role !== 'host' && role !== 'guest') return true;
  if (count <= 1) return true;

  // A guest's additions go to the host as suggestions (orbitGuestTakesQueueAdd),
  // so the question says that.
  const guestSuggests = role === 'guest' && useOrbitStore.getState().phase === 'active';
  return useConfirmModalStore.getState().request({
    title: i18n.t(guestSuggests ? 'orbit.bulkConfirmGuestTitle' : 'orbit.bulkConfirmTitle'),
    message: i18n.t(guestSuggests ? 'orbit.bulkConfirmGuestBody' : 'orbit.bulkConfirmBody', { count }),
    confirmLabel: i18n.t(guestSuggests ? 'orbit.bulkConfirmGuestYes' : 'orbit.bulkConfirmYes'),
    cancelLabel: i18n.t('orbit.bulkConfirmNo'),
  });
}

// Install the orbit runtime into the core seam at module init. The
// @/features/orbit barrel re-exports this module, so the topbar's barrel import
// evaluates it at boot — before any Orbit session can start.
registerOrbitRuntime({
  getSnapshot: () => {
    const o = useOrbitStore.getState();
    return { role: o.role, phase: o.phase, state: o.state, serverId: o.serverId };
  },
  bulkGuard: orbitBulkGuard,
  suggestTracks: suggestOrbitTracks,
  allowsTrackServer: (serverId) => {
    const orbit = useOrbitStore.getState();
    if (orbit.role !== 'host' || orbit.phase !== 'active') return true;
    if (!orbit.serverId) return false;
    return orbitActionServerMatches(
      orbit.serverId,
      serverId,
      useAuthStore.getState().activeServerId,
    );
  },
});
