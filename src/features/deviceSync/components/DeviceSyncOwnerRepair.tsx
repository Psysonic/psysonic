import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deviceSyncUnresolvedOwnerKey,
  useDeviceSyncStore,
} from '@/features/deviceSync/store/deviceSyncStore';
import { runDeviceSyncOwnerRepair } from '@/features/deviceSync/utils/runDeviceSyncOwnerRepair';
import { showToast } from '@/lib/dom/toast';
import { navidromeCanonicalCheckpointStatus } from '@/lib/server/navidromeCanonicalCheckpointStatus';
import { serverIndexKeyForProfile } from '@/lib/server/serverBaseUrl';
import { useAuthStore } from '@/store/authStore';
import { deviceSyncJobIsActive, useDeviceSyncJobStore } from '@/features/deviceSync/store/deviceSyncJobStore';

/**
 * Offered when the device's sources belong to a server address that is no
 * longer configured — typically because the server moved. Without it the
 * configuration is stuck: every listing fails, and the manifest writes the dead
 * owner back on each attach.
 */
export default function DeviceSyncOwnerRepair() {
  const { t } = useTranslation();
  const sources = useDeviceSyncStore(state => state.sources);
  const targetDir = useDeviceSyncStore(state => state.targetDir);
  const legacySources = useDeviceSyncStore(state => state.legacySources);
  const servers = useAuthStore(state => state.servers);
  const [selectedOwner, setSelectedOwner] = useState('');
  const [repairing, setRepairing] = useState(false);
  const syncActive = useDeviceSyncJobStore(state => deviceSyncJobIsActive(state.status));

  const unresolvedOwnerKey = useMemo(
    () => deviceSyncUnresolvedOwnerKey(sources, servers),
    [sources, servers],
  );
  const serverOptions = useMemo(() => {
    const unique = new Map<string, string>();
    servers.forEach(server => {
      const serverIndexKey = serverIndexKeyForProfile(server);
      if (serverIndexKey && !unique.has(serverIndexKey)) unique.set(serverIndexKey, server.name || server.url);
    });
    return [...unique.entries()].map(([serverIndexKey, label]) => ({ serverIndexKey, label }));
  }, [servers]);

  // Legacy recovery owns the screen while it is up; both panels at once would
  // ask the user the same question twice about two different source sets.
  if (!unresolvedOwnerKey || legacySources.length > 0) return null;

  const selectedStatus = selectedOwner
    ? navidromeCanonicalCheckpointStatus(selectedOwner)
    : 'absent';
  const migrationPending = selectedStatus === 'pending' || selectedStatus === 'invalid';
  const repairDisabled = repairing || syncActive || !selectedOwner || migrationPending || !targetDir;

  const repair = async () => {
    if (repairing) return;
    setRepairing(true);
    try {
      const result = await runDeviceSyncOwnerRepair({
        previousOwnerServerIndexKey: unresolvedOwnerKey,
        nextOwnerServerIndexKey: selectedOwner,
      });
      if (result === 'repaired') {
        showToast(t('deviceSync.ownerRepairComplete'), 4000, 'info');
        return;
      }
      showToast(
        t(result === 'no-target' ? 'deviceSync.noTargetDir' : 'deviceSync.ownerRepairFailed'),
        5000, 'error',
      );
    } finally {
      setRepairing(false);
    }
  };

  return (
    <section className="device-sync-legacy-recovery" aria-labelledby="device-sync-owner-repair-title">
      <div>
        <h2 id="device-sync-owner-repair-title">{t('deviceSync.ownerRepairTitle')}</h2>
        <p>{t('deviceSync.ownerRepairDescription', { server: unresolvedOwnerKey })}</p>
      </div>
      <div className="device-sync-legacy-recovery-actions">
        <label htmlFor="device-sync-owner-repair-server">{t('deviceSync.legacyRecoveryServer')}</label>
        <select
          id="device-sync-owner-repair-server"
          value={selectedOwner}
          disabled={repairing || syncActive}
          onChange={event => setSelectedOwner(event.target.value)}
        >
          <option value="">{t('deviceSync.legacyRecoveryChooseServer')}</option>
          {serverOptions.map(option => (
            <option key={option.serverIndexKey} value={option.serverIndexKey}>{option.label}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" disabled={repairDisabled} onClick={() => { void repair(); }}>
          {t('deviceSync.ownerRepairApply')}
        </button>
      </div>
      {!targetDir && <p className="device-sync-legacy-recovery-note">{t('deviceSync.ownerRepairNeedsDevice')}</p>}
      {migrationPending && <p className="device-sync-legacy-recovery-note">{t('deviceSync.legacyRecoveryPending')}</p>}
    </section>
  );
}
