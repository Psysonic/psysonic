import React from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, RefreshCw, Usb } from 'lucide-react';

interface Props {
  drivesLoading: boolean;
  isRunning: boolean;
  refreshDrives: () => Promise<void>;
  handleChooseFolder: () => Promise<void>;
}

/** Shown instead of the lists until a target is chosen: the page has no next step before that. */
export default function DeviceSyncTargetEmpty({
  drivesLoading, isRunning, refreshDrives, handleChooseFolder,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="device-sync-target-empty" role="status">
      <Usb size={32} className="device-sync-target-empty-icon" aria-hidden="true" />
      <h2 className="device-sync-target-empty-title">{t('deviceSync.emptyTargetTitle')}</h2>
      <p className="device-sync-target-empty-text">{t('deviceSync.emptyTargetText')}</p>
      <div className="device-sync-target-empty-actions">
        <button
          type="button"
          className="btn btn-surface"
          onClick={refreshDrives}
          disabled={drivesLoading || isRunning}
        >
          <RefreshCw size={15} className={drivesLoading ? 'spin' : ''} aria-hidden="true" />
          {t('deviceSync.emptyTargetFind')}
        </button>
        <button
          type="button"
          className="btn btn-surface"
          onClick={handleChooseFolder}
          disabled={isRunning}
        >
          <FolderOpen size={15} aria-hidden="true" />
          {t('deviceSync.emptyTargetFolder')}
        </button>
      </div>
    </div>
  );
}
