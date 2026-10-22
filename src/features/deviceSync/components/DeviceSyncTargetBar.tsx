import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle, Folder, FolderOpen, RefreshCw, Usb,
} from 'lucide-react';
import CustomSelect from '@/ui/CustomSelect';
import type { RemovableDrive } from '@/features/deviceSync/utils/deviceSyncHelpers';
import { formatBytes } from '@/features/deviceSync/utils/deviceSyncHelpers';

interface Props {
  targetDir: string | null;
  setTargetDir: (dir: string) => void;
  drives: RemovableDrive[];
  drivesLoading: boolean;
  activeDrive: RemovableDrive | null;
  refreshDrives: () => Promise<void>;
  scanDevice: () => Promise<void>;
  handleChooseFolder: () => Promise<void>;
  targetIsLocal: boolean;
  isRunning: boolean;
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Step 1 of the page: where the music goes. */
export default function DeviceSyncTargetBar({
  targetDir, setTargetDir, drives, drivesLoading, activeDrive,
  refreshDrives, scanDevice, handleChooseFolder, targetIsLocal, isRunning,
}: Props) {
  const { t } = useTranslation();
  const localTargetOption = targetIsLocal && targetDir
    ? [{ value: targetDir, label: `${t('deviceSync.localTargetBadge')}: ${folderName(targetDir)}` }]
    : [];
  const hasChoices = drives.length > 0 || localTargetOption.length > 0;

  return (
    <section className="device-sync-step device-sync-target" aria-labelledby="device-sync-target-title">
      <h2 id="device-sync-target-title" className="device-sync-step-title">
        <span className="device-sync-step-num" aria-hidden="true">1</span>
        {t('deviceSync.targetDevice')}
      </h2>
      <div className="device-sync-target-row">
        {hasChoices ? (
          <div className="device-sync-target-select">
            {activeDrive || !targetIsLocal
              ? <Usb size={18} className="device-sync-drive-icon" aria-hidden="true" />
              : <Folder size={18} className="device-sync-drive-icon" aria-hidden="true" />}
            <CustomSelect
              className="input device-sync-drive-select"
              value={targetDir ?? ''}
              disabled={isRunning}
              ariaLabel={t('deviceSync.targetDevice')}
              onChange={v => {
                setTargetDir(v);
                if (v) {
                  setTimeout(() => scanDevice(), 100);
                }
              }}
              options={[
                { value: '', label: t('deviceSync.selectDrive') },
                ...localTargetOption,
                ...drives.map(d => ({ value: d.mount_point, label: d.name || d.mount_point })),
              ]}
            />
          </div>
        ) : (
          <span className="device-sync-no-drives">
            <AlertCircle size={16} aria-hidden="true" />
            {t('deviceSync.noDrivesDetected')}
          </span>
        )}
        <div className="device-sync-target-buttons">
          <button
            type="button"
            className="btn btn-ghost device-sync-icon-btn"
            onClick={refreshDrives}
            disabled={drivesLoading || isRunning}
            aria-label={t('deviceSync.refreshDrives')}
            data-tooltip={t('deviceSync.refreshDrives')}
          >
            <RefreshCw size={18} className={drivesLoading ? 'spin' : ''} />
          </button>
          <button
            type="button"
            className="btn btn-ghost device-sync-icon-btn"
            onClick={handleChooseFolder}
            disabled={isRunning}
            aria-label={t('deviceSync.browseManual')}
            data-tooltip={t('deviceSync.browseManual')}
          >
            <FolderOpen size={18} />
          </button>
        </div>
        {activeDrive && (
          <span className="device-sync-drive-meta">
            {formatBytes(activeDrive.available_space)} {t('deviceSync.free')} / {formatBytes(activeDrive.total_space)} &bull; {activeDrive.file_system}
          </span>
        )}
        {!activeDrive && targetIsLocal && targetDir && (
          <span className="device-sync-drive-meta device-sync-drive-path" title={targetDir}>{targetDir}</span>
        )}
      </div>
    </section>
  );
}
