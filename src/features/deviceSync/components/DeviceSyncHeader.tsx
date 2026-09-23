import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle, Folder, FolderOpen, HardDriveUpload, RefreshCw, Usb,
} from 'lucide-react';
import CustomSelect from '@/ui/CustomSelect';
import type { RemovableDrive } from '@/features/deviceSync/utils/deviceSyncHelpers';
import { formatBytes } from '@/features/deviceSync/utils/deviceSyncHelpers';
import {
  DEVICE_SYNC_TRANSCODE_BITRATES,
  type DeviceSyncLayoutMode,
  type DeviceSyncPlaylistPathMode,
  type DeviceSyncSource,
  type DeviceSyncTranscode,
  type DeviceSyncTranscodeFormat,
} from '@/features/deviceSync/store/deviceSyncStore';

interface Props {
  targetDir: string | null;
  setTargetDir: (dir: string) => void;
  sources: DeviceSyncSource[];
  drives: RemovableDrive[];
  drivesLoading: boolean;
  activeDrive: RemovableDrive | null;
  refreshDrives: () => Promise<void>;
  scanDevice: () => Promise<void>;
  handleChooseFolder: () => Promise<void>;
  startMigrationPreview: () => Promise<void>;
  layoutMode: DeviceSyncLayoutMode;
  playlistPathMode: DeviceSyncPlaylistPathMode;
  setLayoutMode: (mode: DeviceSyncLayoutMode) => void;
  setPlaylistPathMode: (mode: DeviceSyncPlaylistPathMode) => void;
  transcode: DeviceSyncTranscode;
  setTranscode: (transcode: DeviceSyncTranscode) => void;
  targetIsLocal: boolean;
  isRunning: boolean;
}

const TRANSCODE_FORMAT_LABEL_KEYS: Record<DeviceSyncTranscodeFormat, string> = {
  original: 'deviceSync.transcodeOriginal',
  mp3: 'deviceSync.transcodeMp3',
  aac: 'deviceSync.transcodeAac',
  opus: 'deviceSync.transcodeOpus',
};

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export default function DeviceSyncHeader({
  targetDir, setTargetDir, sources, drives, drivesLoading, activeDrive,
  refreshDrives, scanDevice, handleChooseFolder, startMigrationPreview,
  layoutMode, playlistPathMode, setLayoutMode, setPlaylistPathMode,
  transcode, setTranscode, targetIsLocal, isRunning,
}: Props) {
  const { t } = useTranslation();
  // Self-contained playlists sit next to their files, so only absolute paths
  // change anything there; absolute paths are offered for local folders.
  const pathStyleOptions = [
    ...(layoutMode !== 'self-contained'
      ? [
          { value: 'playlist-relative', label: t('deviceSync.playlistPathRelative') },
          { value: 'device-rooted', label: t('deviceSync.playlistPathRooted') },
        ]
      : [{ value: 'playlist-relative', label: t('deviceSync.playlistPathRelative') }]),
    ...(targetIsLocal || playlistPathMode === 'absolute'
      ? [{ value: 'absolute', label: t('deviceSync.playlistPathAbsolute') }]
      : []),
  ];
  const showPathStyle = layoutMode !== 'self-contained' || pathStyleOptions.length > 1;
  const localTargetOption = targetIsLocal && targetDir
    ? [{ value: targetDir, label: `${t('deviceSync.localTargetBadge')}: ${folderName(targetDir)}` }]
    : [];

  return (
    <div className="device-sync-header">
      <div className="device-sync-header-title">
        <HardDriveUpload size={20} />
        <h1>{t('deviceSync.title')}</h1>
      </div>

      <div className="device-sync-config-row">

        {/* ── Left: Fixed schema info ── */}
        <div className="device-sync-schema-section">
          <span className="device-sync-label-inline">{t('deviceSync.schemaLabel', { defaultValue: 'Naming scheme' })}</span>
          <code className="device-sync-schema-code">
            {layoutMode === 'flat'
              ? '{AlbumArtist} - {Album} - {TrackNum} - {Title}.{ext}'
              : '{AlbumArtist}/{Album}/{TrackNum} - {Title}.{ext}'}
          </code>
          <span className="device-sync-schema-hint">
            {layoutMode === 'flat'
              ? t('deviceSync.flatLayoutHint')
              : layoutMode === 'shared-album-tree'
                ? t('deviceSync.sharedLayoutHint')
                : t('deviceSync.selfContainedLayoutHint')}
          </span>
          <div className="device-sync-playlist-options">
            <label>
              <span className="device-sync-label-inline">{t('deviceSync.layout')}</span>
              <CustomSelect
                className="input device-sync-layout-select"
                value={layoutMode}
                onChange={value => setLayoutMode(value as DeviceSyncLayoutMode)}
                disabled={isRunning}
                ariaLabel={t('deviceSync.layout')}
                options={[
                  { value: 'self-contained', label: t('deviceSync.playlistStorageSelfContained') },
                  { value: 'shared-album-tree', label: t('deviceSync.playlistStorageShared') },
                  { value: 'flat', label: t('deviceSync.layoutFlat') },
                ]}
              />
            </label>
            {showPathStyle && (
              <label>
                <span className="device-sync-label-inline">{t('deviceSync.playlistPathStyle')}</span>
                <CustomSelect
                  className="input device-sync-layout-select"
                  value={playlistPathMode}
                  onChange={value => setPlaylistPathMode(value as DeviceSyncPlaylistPathMode)}
                  disabled={isRunning}
                  ariaLabel={t('deviceSync.playlistPathStyle')}
                  options={pathStyleOptions}
                />
              </label>
            )}
            <label>
              <span className="device-sync-label-inline">{t('deviceSync.transcodeFormat')}</span>
              <CustomSelect
                className="input device-sync-layout-select"
                value={transcode.format}
                onChange={value => setTranscode({ ...transcode, format: value as DeviceSyncTranscodeFormat })}
                disabled={isRunning}
                ariaLabel={t('deviceSync.transcodeFormat')}
                options={(Object.keys(TRANSCODE_FORMAT_LABEL_KEYS) as DeviceSyncTranscodeFormat[]).map(format => ({
                  value: format,
                  label: t(TRANSCODE_FORMAT_LABEL_KEYS[format]),
                }))}
              />
            </label>
            {transcode.format !== 'original' && (
              <label>
                <span className="device-sync-label-inline">{t('deviceSync.transcodeBitrate')}</span>
                <CustomSelect
                  className="input device-sync-layout-select"
                  value={String(transcode.maxBitRateKbps)}
                  onChange={value => setTranscode({ ...transcode, maxBitRateKbps: Number(value) })}
                  disabled={isRunning}
                  ariaLabel={t('deviceSync.transcodeBitrate')}
                  options={DEVICE_SYNC_TRANSCODE_BITRATES.map(kbps => ({
                    value: String(kbps),
                    label: kbps === 0
                      ? t('deviceSync.transcodeBitrateServer')
                      : t('deviceSync.transcodeBitrateValue', { kbps }),
                  }))}
                />
              </label>
            )}
          </div>
          {transcode.format !== 'original' && (
            <span className="device-sync-schema-hint">{t('deviceSync.transcodeHint')}</span>
          )}
          {targetIsLocal && (
            <span className="device-sync-schema-hint">{t('deviceSync.localTargetHint')}</span>
          )}
          {targetDir && sources.length > 0 && (
            <button
              className="btn btn-ghost device-sync-migrate-btn"
              onClick={startMigrationPreview}
              disabled={isRunning}
              data-tooltip={t('deviceSync.migrateTooltip', {
                defaultValue: 'Rename existing files on the device into the new scheme (from the old filename template).',
              })}
              data-tooltip-pos="bottom"
            >
              {t('deviceSync.migrateButton', { defaultValue: 'Reorganize existing files…' })}
            </button>
          )}
        </div>

        {/* ── Right: Drive config ── */}
        <div className="device-sync-target-section">
          <span className="device-sync-label-inline">{t('deviceSync.targetDevice')}</span>
          <div className="device-sync-header-config">
            <div className="device-sync-drive-layout">
              {/* Row 1: Controls */}
              <div className="device-sync-drive-controls">
                {/* Fallback manual folder picker & Refresh */}
                <button className="btn btn-ghost" onClick={handleChooseFolder} disabled={isRunning} data-tooltip={t('deviceSync.browseManual')}>
                  <FolderOpen size={18} />
                </button>
                <button
                  className="btn btn-ghost device-sync-refresh-btn"
                  onClick={refreshDrives}
                  disabled={drivesLoading || isRunning}
                  data-tooltip={t('deviceSync.refreshDrives')}
                >
                  <RefreshCw size={18} className={drivesLoading ? 'spin' : ''} />
                </button>

                {/* Dropdown element */}
                {drives.length > 0 || localTargetOption.length > 0 ? (
                  <>
                    {activeDrive || !targetIsLocal
                      ? <Usb size={18} className="device-sync-drive-icon" />
                      : <Folder size={18} className="device-sync-drive-icon" />}
                    <CustomSelect
                      className="input device-sync-drive-select"
                      value={targetDir ?? ''}
                      disabled={isRunning}
                      onChange={v => {
                        setTargetDir(v);
                        if (v) {
                          setTimeout(() => scanDevice(), 100);
                        }
                      }}
                      options={[
                        { value: '', label: t('deviceSync.selectDrive') },
                        ...localTargetOption,
                        ...drives.map(d => ({ value: d.mount_point, label: d.name || d.mount_point }))
                      ]}
                    />
                  </>
                ) : (
                  <span className="device-sync-no-drives">
                    <AlertCircle size={18} />
                    {t('deviceSync.noDrivesDetected')}
                  </span>
                )}
              </div>

            {/* Row 2: Metadata */}
            {activeDrive && (
              <div className="device-sync-drive-meta">
                {formatBytes(activeDrive.available_space)} {t('deviceSync.free')} / {formatBytes(activeDrive.total_space)} &bull; {activeDrive.file_system}
              </div>
            )}
            {!activeDrive && targetIsLocal && targetDir && (
              <div className="device-sync-drive-meta">{targetDir}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}
