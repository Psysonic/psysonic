import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle, CheckCircle2, Clock, HardDriveUpload, Loader2, Trash2,
} from 'lucide-react';
import { cancelDeviceSync } from '@/lib/api/syncfs';
import {
  useDeviceSyncJobStore,
  type DeviceSyncJobStatus,
} from '@/features/deviceSync/store/deviceSyncJobStore';

interface Props {
  syncedCount: number;
  pendingCount: number;
  deletionCount: number;
  checkedCount: number;
  isRunning: boolean;
  actionButtonLabel: string;
  actionButtonDisabled: boolean;
  promptSyncSummary: () => Promise<void>;
  handleMarkCheckedForDeletion: () => void;
  jobStatus: DeviceSyncJobStatus;
  jobDone: number;
  jobSkip: number;
  jobFail: number;
  jobTotal: number;
}

function requestCancel(): void {
  const store = useDeviceSyncJobStore.getState();
  if (!store.jobId) return;
  store.requestCancel();
  void cancelDeviceSync({ jobId: store.jobId }).catch(() => {
    useDeviceSyncJobStore.getState().cancelRequestFailed();
  });
}

/** Pinned to the bottom of the page: where the device stands and what the next click does. */
export default function DeviceSyncActionBar({
  syncedCount, pendingCount, deletionCount, checkedCount,
  isRunning, actionButtonLabel, actionButtonDisabled,
  promptSyncSummary, handleMarkCheckedForDeletion,
  jobStatus, jobDone, jobSkip, jobFail, jobTotal,
}: Props) {
  const { t } = useTranslation();
  const dismiss = () => useDeviceSyncJobStore.getState().reset();
  const inProgress = jobStatus === 'running' || jobStatus === 'cancelling' || jobStatus === 'finalizing';
  const processed = jobDone + jobSkip + jobFail;

  let status: React.ReactNode;
  if (inProgress) {
    status = (
      <div className="device-sync-bar-progress" role="status">
        <span className="device-sync-bar-text">
          <Loader2 size={13} className="spin" aria-hidden="true" />
          {t('deviceSync.syncInProgress', { done: jobDone + jobSkip, total: jobTotal })}
          {jobFail > 0 && (
            <span className="device-sync-stat-error"><AlertCircle size={12} aria-hidden="true" /> {jobFail}</span>
          )}
        </span>
        <div className="device-sync-bar-track" aria-hidden="true">
          <div
            className="device-sync-bar-fill"
            style={{ width: jobTotal > 0 ? `${(processed / jobTotal) * 100}%` : '0%' }}
          />
        </div>
      </div>
    );
  } else if (jobStatus === 'done' || jobStatus === 'cancelled' || jobStatus === 'failed') {
    const icon = jobStatus === 'done'
      ? <CheckCircle2 size={13} className="color-success" aria-hidden="true" />
      : <AlertCircle size={13} className={jobStatus === 'failed' ? 'color-error' : ''} aria-hidden="true" />;
    const text = jobStatus === 'done'
      ? t('deviceSync.syncResult', { done: jobDone, skipped: jobSkip, total: jobTotal })
      : jobStatus === 'cancelled'
        ? t('deviceSync.syncCancelled', { done: jobDone, total: jobTotal })
        : t('deviceSync.fetchError');
    status = (
      <span className="device-sync-bar-text" role="status">
        {icon}{text}
        <button type="button" className="btn btn-ghost device-sync-bar-dismiss" onClick={dismiss}>
          {t('deviceSync.dismiss')}
        </button>
      </span>
    );
  } else {
    status = (
      <div className="device-sync-bar-badges">
        {syncedCount > 0 && (
          <span className="device-sync-badge synced">
            <CheckCircle2 size={12} aria-hidden="true" /> {syncedCount} {t('deviceSync.statusSynced')}
          </span>
        )}
        {pendingCount > 0 && (
          <span className="device-sync-badge pending">
            <Clock size={12} aria-hidden="true" /> {pendingCount} {t('deviceSync.statusPending')}
          </span>
        )}
        {deletionCount > 0 && (
          <span className="device-sync-badge deletion">
            <Trash2 size={12} aria-hidden="true" /> {deletionCount} {t('deviceSync.statusDeletion')}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="device-sync-actionbar">
      <div className="device-sync-bar-status">{status}</div>
      <div className="device-sync-bar-actions">
        {jobStatus === 'running' && (
          <button type="button" className="btn btn-ghost" onClick={requestCancel}>
            {t('deviceSync.cancelSync')}
          </button>
        )}
        {checkedCount > 0 && !isRunning && (
          <button type="button" className="btn btn-danger" onClick={handleMarkCheckedForDeletion}>
            <Trash2 size={14} aria-hidden="true" />
            {t('deviceSync.deleteFromDevice', { count: checkedCount })}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={promptSyncSummary}
          disabled={actionButtonDisabled}
        >
          {isRunning
            ? <><Loader2 size={14} className="spin" aria-hidden="true" /> {processed}/{jobTotal}</>
            : <>
                {deletionCount > 0 && pendingCount === 0
                  ? <Trash2 size={14} aria-hidden="true" />
                  : <HardDriveUpload size={14} aria-hidden="true" />}
                {actionButtonLabel}
              </>}
        </button>
      </div>
    </div>
  );
}
