import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionStatus } from '@/lib/hooks/useConnectionStatus';
import { pullPlayQueueFromServer } from '@/features/playback/store/applyServerPlayQueue';
import { useOrbitStore } from '@/features/orbit';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { profileIdFromQueueRef } from '@/lib/media/trackServerScope';
import { getPlaybackServerId } from '@/features/playback/utils/playback/playbackServer';
import {
  getIdleQueuePullSuspendedSnapshot,
  subscribeIdleQueuePullSuspended,
} from '@/features/playback/store/queuePlaybackIdle';
import { clearQueueHandoffPending } from '@/features/playback/store/queueSyncUiState';
import { showToast } from '@/lib/dom/toast';
import {
  isPlayQueueSyncEnabled,
  usePlayQueueSyncSettingsStore,
} from '@/features/playback/store/playQueueSyncSettingsStore';

export function usePlayQueueSyncLedState(status: ConnectionStatus) {
  const { t } = useTranslation();
  const orbitRole = useOrbitStore(s => s.role);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const currentRadio = usePlayerStore(s => s.currentRadio);
  const playQueueSyncEnabled = usePlayQueueSyncSettingsStore(s => s.enabled);
  const [pullInFlight, setPullInFlight] = useState(false);
  const idlePullSuspended = useSyncExternalStore(
    subscribeIdleQueuePullSuspended,
    getIdleQueuePullSuspendedSnapshot,
  );

  const queueItems = usePlayerStore(s => s.queueItems);
  const queueIndex = usePlayerStore(s => s.queueIndex);
  const currentTrackId = usePlayerStore(s => s.currentTrack?.id);
  const playbackServerId = useMemo(
    () => getPlaybackServerId(),
    // getPlaybackServerId() reads global queue/auth state; the listed values
    // are intentional recompute triggers, not direct inputs to the body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queueItems, queueIndex, currentTrackId],
  );
  const queueServerIds = useMemo(() => {
    const ids = [...new Set(queueItems.map(profileIdFromQueueRef).filter(Boolean))];
    return ids.length > 0 ? ids : (playbackServerId ? [playbackServerId] : []);
  }, [playbackServerId, queueItems]);

  useEffect(() => {
    clearQueueHandoffPending();
  }, [playbackServerId]);

  const autoSyncContext = canAutoIdlePlayQueuePull(status, orbitRole);
  const localQueueSyncPaused = autoSyncContext && idlePullSuspended && !isPlaying;

  const needsQueuePull = status === 'connected'
    && queueServerIds.length > 0
    && localQueueSyncPaused;

  const queueHandoffReason = false;

  const ledVariant = status === 'checking'
    ? 'checking'
    : status === 'disconnected'
      ? 'disconnected'
      : needsQueuePull
        ? 'queue-handoff'
        : 'connected';

  const pullFromQueueServers = useCallback(async () => {
    if (!playQueueSyncEnabled) return;
    if (status !== 'connected' || pullInFlight) return;
    if (orbitRole === 'host' || orbitRole === 'guest') return;
    if (currentRadio) return;
    if (queueServerIds.length === 0) return;

    setPullInFlight(true);
    try {
      let result: 'applied' | 'noop' | 'empty' | 'error' = 'noop';
      for (const serverId of queueServerIds) {
        result = await pullPlayQueueFromServer(serverId);
        if (result === 'error') break;
      }
      switch (result) {
        case 'noop':
          showToast(t('connection.queueSynced'), 2500, 'info');
          break;
        case 'empty':
          showToast(t('connection.queuePullEmpty'), 4000, 'info');
          break;
        case 'applied':
          showToast(t('connection.queuePullSuccess'), 3000, 'info');
          break;
        case 'error':
          showToast(t('connection.queuePullFailed'), 5000, 'error');
          break;
        default:
          break;
      }
    } finally {
      setPullInFlight(false);
    }
  }, [currentRadio, orbitRole, playQueueSyncEnabled, pullInFlight, queueServerIds, status, t]);

  const syncRingVisible = status === 'connected' && (needsQueuePull || pullInFlight);

  return {
    ledVariant,
    needsQueuePull,
    localQueueSyncPaused,
    queueHandoffReason,
    pullInFlight,
    syncRingVisible,
    pullFromActiveServer: pullFromQueueServers,
  };
}

export function canAutoIdlePlayQueuePull(
  status: ConnectionStatus,
  orbitRole: string | null,
): boolean {
  if (!isPlayQueueSyncEnabled()) return false;
  if (status !== 'connected') return false;
  if (orbitRole === 'host' || orbitRole === 'guest') return false;
  if (usePlayerStore.getState().currentRadio) return false;
  const playbackId = getPlaybackServerId();
  return Boolean(playbackId);
}
