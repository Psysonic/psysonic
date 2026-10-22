import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useRefElementClientWidth } from '@/lib/hooks/useResizeClientHeight';
import { useTranslation } from 'react-i18next';
import {
  deviceSyncSourceKey,
  sameDeviceSyncTranscode,
  useDeviceSyncStore,
  type DeviceSyncSource,
} from '@/features/deviceSync/store/deviceSyncStore';
import {
  deviceSyncJobIsActive,
  useDeviceSyncJobStore,
} from '@/features/deviceSync/store/deviceSyncJobStore';

import {
  type SourceTab,
} from '@/features/deviceSync/utils/deviceSyncHelpers';
import { useDeviceSyncDrives } from '@/features/deviceSync/hooks/useDeviceSyncDrives';
import { useDeviceSyncSourceStatuses } from '@/features/deviceSync/hooks/useDeviceSyncSourceStatuses';
import { useDeviceSyncBrowser } from '@/features/deviceSync/hooks/useDeviceSyncBrowser';
import { useDeviceSyncDeviceScan } from '@/features/deviceSync/hooks/useDeviceSyncDeviceScan';
import { useDeviceSyncOwnerRelocation } from '@/features/deviceSync/hooks/useDeviceSyncOwnerRelocation';
import {
  runDeviceSyncMigrationPreview,
  runDeviceSyncMigrationExecute,
  type MigrationPhase, type MigrationPair, type MigrationResult,
} from '@/features/deviceSync/utils/runDeviceSyncMigration';
import {
  runDeviceSyncSummaryPrompt,
  runDeviceSyncExecute,
  type SyncDelta,
} from '@/features/deviceSync/utils/runDeviceSyncExecution';
import { runDeviceSyncChooseFolder } from '@/features/deviceSync/utils/runDeviceSyncChooseFolder';
import { HardDriveUpload } from 'lucide-react';
import DeviceSyncTargetBar from '@/features/deviceSync/components/DeviceSyncTargetBar';
import DeviceSyncOptions from '@/features/deviceSync/components/DeviceSyncOptions';
import DeviceSyncTargetEmpty from '@/features/deviceSync/components/DeviceSyncTargetEmpty';
import DeviceSyncActionBar from '@/features/deviceSync/components/DeviceSyncActionBar';
import DeviceSyncPreSyncModal from '@/features/deviceSync/components/DeviceSyncPreSyncModal';
import DeviceSyncMigrationModal from '@/features/deviceSync/components/DeviceSyncMigrationModal';
import DeviceSyncBrowserPanel from '@/features/deviceSync/components/DeviceSyncBrowserPanel';
import DeviceSyncDevicePanel from '@/features/deviceSync/components/DeviceSyncDevicePanel';
import DeviceSyncLegacyRecovery from '@/features/deviceSync/components/DeviceSyncLegacyRecovery';
import DeviceSyncOwnerRepair from '@/features/deviceSync/components/DeviceSyncOwnerRepair';

/** Below this page width the two lists stack (page padding included). */
const DEVICE_SYNC_NARROW_WIDTH = 780;
/** Below this the source tabs show icons only. */
const DEVICE_SYNC_TINY_WIDTH = 440;

// ─── component ───────────────────────────────────────────────────────────────

export default function DeviceSync() {
  const { t } = useTranslation();

  const targetDir        = useDeviceSyncStore(s => s.targetDir);
  const layoutMode       = useDeviceSyncStore(s => s.layoutMode);
  const playlistPathMode = useDeviceSyncStore(s => s.playlistPathMode);
  const syncedLayoutMode = useDeviceSyncStore(s => s.syncedLayoutMode);
  const syncedPlaylistPathMode = useDeviceSyncStore(s => s.syncedPlaylistPathMode);
  const transcode        = useDeviceSyncStore(s => s.transcode);
  const syncedTranscode  = useDeviceSyncStore(s => s.syncedTranscode);
  const sources          = useDeviceSyncStore(s => s.sources);
  const checkedIds       = useDeviceSyncStore(s => s.checkedIds);
  const pendingDeletion  = useDeviceSyncStore(s => s.pendingDeletion);
  const pendingPlan      = useDeviceSyncStore(s => s.pendingPlan);
  const targetDeviceId   = useDeviceSyncStore(s => s.targetDeviceId);
  const pendingPlanDeviceId = useDeviceSyncStore(s => s.pendingPlanDeviceId);
  const pendingPlanChecked = useDeviceSyncStore(s => s.pendingPlanChecked);
  const deviceFilePaths  = useDeviceSyncStore(s => s.deviceFilePaths);
  const scanning         = useDeviceSyncStore(s => s.scanning);
  const deviceHasLegacyTemplate = useDeviceSyncStore(s => s.deviceHasLegacyTemplate);
  const {
    setTargetDir, setLayoutMode, setPlaylistPathMode, setTranscode, addSource, removeSource,
    toggleChecked, setCheckedIds, markForDeletion,
    unmarkDeletion,
  } = useDeviceSyncStore.getState();

  const jobStatus = useDeviceSyncJobStore(s => s.status);
  const jobDone   = useDeviceSyncJobStore(s => s.done);
  const jobSkip   = useDeviceSyncJobStore(s => s.skipped);
  const jobFail   = useDeviceSyncJobStore(s => s.failed);
  const jobTotal  = useDeviceSyncJobStore(s => s.total);

  const [activeTab, setActiveTab]           = useState<SourceTab>('albums');
  const [search, setSearch]                 = useState('');
  const resetSearch = useCallback(() => setSearch(''), []);
  // ─── Removable drive detection ──────────────────────────────────────────
  const { drives, drivesLoading, activeDrive, driveDetected, targetIsLocal, refreshDrives } =
    useDeviceSyncDrives(targetDir);

  const [preSyncOpen, setPreSyncOpen] = useState(false);
  const [preSyncLoading, setPreSyncLoading] = useState(false);
  const [syncDelta, setSyncDelta] = useState<SyncDelta>({
    planId: '',
    deviceId: '',
    addBytes: 0,
    addCount: 0,
    delBytes: 0,
    delCount: 0,
    reclaimableBytes: 0,
    availableBytes: 0,
    tracks: [] as SubsonicSong[],
    deletePaths: [],
    deferredDeletePaths: [],
    moveCount: 0,
    skippedCount: 0,
    playlists: [],
    manifestFiles: [],
    manifestPlaylists: [],
    context: null,
  });

  // ─── Migration (rename existing files into the fixed scheme) ────────────
  const [migrationPhase, setMigrationPhase] = useState<MigrationPhase>('closed');
  const [migrationOldTemplate, setMigrationOldTemplate] = useState<string>('');
  const [migrationPairs, setMigrationPairs] = useState<MigrationPair[]>([]);
  const [migrationCollisions, setMigrationCollisions] = useState<MigrationPair[]>([]);
  const [migrationUnchanged, setMigrationUnchanged] = useState(0);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);

  const isRunning = deviceSyncJobIsActive(jobStatus);
  // The M3U path style only matters where playlists point at shared tracks,
  // or everywhere once full paths are involved.
  const pathStyleMatters = layoutMode !== 'self-contained'
    || playlistPathMode === 'absolute'
    || syncedPlaylistPathMode === 'absolute';
  const configurationDirty = layoutMode !== syncedLayoutMode
    || (pathStyleMatters && playlistPathMode !== syncedPlaylistPathMode);
  // A new format or bitrate touches every file, not just playlists.
  const transcodeDirty = syncedTranscode !== null && !sameDeviceSyncTranscode(transcode, syncedTranscode);

  // Browser (playlists / albums / artists tabs + their loaders + debounced search)
  const {
    playlists, randomAlbums, albumSearchResults, albumSearchLoading,
    artists, loadingBrowser,
    expandedArtistIds, artistAlbumsMap, loadingArtistIds,
    toggleArtistExpand,
    serverIndexKey: browserServerIndexKey,
    serverProfileId: browserServerProfileId,
    unresolvedOwnerKey,
    loadFailed: browserLoadFailed,
  } = useDeviceSyncBrowser(activeTab, search, resetSearch);

  // ─── Device scan + manifest auto-import ─────────────────────────────────
  const { scanDevice } = useDeviceSyncDeviceScan(
    targetDir,
    sources.length,
    driveDetected,
    t,
    activeDrive
      ? `${activeDrive.mount_point}\0${activeDrive.name}\0${activeDrive.total_space}\0${activeDrive.file_system}`
      : targetIsLocal && targetDir ? `local\0${targetDir}` : null,
  );

  // Follow the owning server when it changes address, before anything reads
  // the now-stale owner key.
  useDeviceSyncOwnerRelocation();

  // Source status (path map + derived synced/pending/deletion)
  const { sourcePathsMap, sourceStatuses } = useDeviceSyncSourceStatuses(
    targetDir, sources, pendingDeletion, deviceFilePaths, layoutMode, configurationDirty,
    transcode, transcodeDirty,
  );

  // ─── Desired State / Diff Logic ─────────────────────────────────────────

  const handleToggleSource = useCallback((source: DeviceSyncSource) => {
    if (deviceSyncJobIsActive(useDeviceSyncJobStore.getState().status)) return;
    const sourceKey = deviceSyncSourceKey(source);
    const isSelected = sources.some(s => deviceSyncSourceKey(s) === sourceKey);
    const isPendingDeletion = pendingDeletion.includes(sourceKey);
    const isActuallySelected = isSelected && !isPendingDeletion;

    if (isActuallySelected) {
      // User initiated a DE-SELECTION. Diff check against target device
      const isSynced = sourceStatuses.get(sourceKey) === 'synced';
      const pathsOnDisk = sourcePathsMap.get(sourceKey)?.filter(p => deviceFilePaths.includes(p)).length || 0;
      
      if (configurationDirty || transcodeDirty || pathsOnDisk > 0 || isSynced) {
        // Source currently has physical footprint. Stage for deletion.
        markForDeletion([sourceKey]);
      } else {
        // Zero physical footprint. Strip safely.
        removeSource(sourceKey);
      }
    } else {
      // User initiated a SELECTION.
      if (isPendingDeletion) {
        unmarkDeletion(sourceKey); // Cancel queued red/strikethrough state
      } else if (!isSelected) {
        addSource(source); // Trigger clean pending install state
      }
    }
  }, [sources, pendingDeletion, sourceStatuses, sourcePathsMap, deviceFilePaths, configurationDirty, transcodeDirty, markForDeletion, removeSource, unmarkDeletion, addSource]);

  // ─── Migration handlers ─────────────────────────────────────────────────

  const startMigrationPreview = () => runDeviceSyncMigrationPreview({
    targetDir, sources,
    setMigrationPhase, setMigrationResult, setMigrationOldTemplate,
    setMigrationPairs, setMigrationCollisions, setMigrationUnchanged,
  });

  const executeMigration = () => runDeviceSyncMigrationExecute({
    targetDir, sources, migrationPairs,
    setMigrationPhase, setMigrationResult, scanDevice,
  });

  const closeMigration = () => {
    setMigrationPhase('closed');
    setMigrationPairs([]);
    setMigrationCollisions([]);
    setMigrationResult(null);
    setMigrationOldTemplate('');
  };

  const handleChooseFolder = () => runDeviceSyncChooseFolder({
    t,
    setTargetDir,
    scanDevice,
  });

  // ─── Sync (non-blocking) ────────────────────────────────────────────────

  const promptSyncSummary = () => runDeviceSyncSummaryPrompt({
    targetDir, sources, pendingDeletion, layoutMode, playlistPathMode, transcode, t,
    setPreSyncLoading, setPreSyncOpen, setSyncDelta,
  });

  const handleSyncExecution = () => runDeviceSyncExecute({
    syncDelta, t,
    setPreSyncOpen, scanDevice,
  });

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleMarkCheckedForDeletion = () => {
    if (checkedIds.length === 0) return;
    markForDeletion(checkedIds);
  };

  const allChecked = sources.length > 0 && sources.every(s => checkedIds.includes(deviceSyncSourceKey(s)));
  const toggleAll  = () => setCheckedIds(allChecked ? [] : sources.map(deviceSyncSourceKey));

  const pendingCount   = Array.from(sourceStatuses.values()).filter(s => s === 'pending').length;
  const syncedCount    = Array.from(sourceStatuses.values()).filter(s => s === 'synced').length;
  const deletionCount  = pendingDeletion.length;

  // ─── Dynamic action button label ────────────────────────────────────────
  const actionButtonLabel = useMemo(() => {
    if (deletionCount > 0 && pendingCount === 0) return t('deviceSync.actionDelete');
    if (pendingCount > 0 && deletionCount === 0) return t('deviceSync.actionTransfer');
    if (pendingCount > 0 && deletionCount > 0)  return t('deviceSync.actionApplyAll');
    return t('deviceSync.syncButton'); // both zero — button will be disabled
  }, [pendingCount, deletionCount, t]);

  // The page width, not the window: sidebar and queue panel take their share.
  const pageRef = useRef<HTMLDivElement>(null);
  const pageWidth = useRefElementClientWidth(pageRef);
  const pageLayout = pageWidth < DEVICE_SYNC_TINY_WIDTH
    ? 'tiny'
    : pageWidth < DEVICE_SYNC_NARROW_WIDTH ? 'narrow' : 'wide';

  const actionButtonDisabled =
    !targetDir ||
    sources.length === 0 ||
    isRunning ||
    !pendingPlanChecked ||
    (pendingPlan && pendingPlanDeviceId !== targetDeviceId) ||
    (!driveDetected && !!targetDir) ||
    (pendingCount === 0 && deletionCount === 0 && !pendingPlan);

  return (
    <div className="device-sync-page" ref={pageRef} data-layout={pageLayout}>

      <div className="device-sync-page-title">
        <HardDriveUpload size={20} aria-hidden="true" />
        <h1>{t('deviceSync.title')}</h1>
      </div>

      <DeviceSyncTargetBar
        targetDir={targetDir}
        setTargetDir={setTargetDir}
        drives={drives}
        drivesLoading={drivesLoading}
        activeDrive={activeDrive}
        refreshDrives={refreshDrives}
        scanDevice={scanDevice}
        handleChooseFolder={handleChooseFolder}
        targetIsLocal={targetIsLocal}
        isRunning={isRunning}
      />

      <DeviceSyncOptions
        layoutMode={layoutMode}
        playlistPathMode={playlistPathMode}
        setLayoutMode={setLayoutMode}
        setPlaylistPathMode={setPlaylistPathMode}
        transcode={transcode}
        setTranscode={setTranscode}
        targetIsLocal={targetIsLocal}
        isRunning={isRunning}
        showMigrate={Boolean(targetDir) && sources.length > 0 && deviceHasLegacyTemplate}
        startMigrationPreview={startMigrationPreview}
      />

      <DeviceSyncLegacyRecovery />
      <DeviceSyncOwnerRepair />

      {!targetDir ? (
        <DeviceSyncTargetEmpty
          drivesLoading={drivesLoading}
          isRunning={isRunning}
          refreshDrives={refreshDrives}
          handleChooseFolder={handleChooseFolder}
        />
      ) : (
      <div className="device-sync-main">

        <DeviceSyncBrowserPanel
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          search={search}
          setSearch={setSearch}
          playlists={playlists}
          randomAlbums={randomAlbums}
          albumSearchResults={albumSearchResults}
          albumSearchLoading={albumSearchLoading}
          artists={artists}
          loadingBrowser={loadingBrowser}
          expandedArtistIds={expandedArtistIds}
          artistAlbumsMap={artistAlbumsMap}
          loadingArtistIds={loadingArtistIds}
          toggleArtistExpand={toggleArtistExpand}
          serverIndexKey={browserServerIndexKey}
          serverProfileId={browserServerProfileId}
          unresolvedOwnerKey={unresolvedOwnerKey}
          loadFailed={browserLoadFailed}
          sources={sources}
          pendingDeletion={pendingDeletion}
          handleToggleSource={handleToggleSource}
          disabled={isRunning}
        />

        <DeviceSyncDevicePanel
          sources={sources}
          sourceStatuses={sourceStatuses}
          driveDetected={driveDetected}
          scanning={scanning}
          checkedIds={checkedIds}
          toggleChecked={toggleChecked}
          allChecked={allChecked}
          toggleAll={toggleAll}
          isRunning={isRunning}
          handleToggleSource={handleToggleSource}
          markForDeletion={markForDeletion}
          unmarkDeletion={unmarkDeletion}
        />

      </div>
      )}

      {targetDir && (
        <DeviceSyncActionBar
          syncedCount={syncedCount}
          pendingCount={pendingCount}
          deletionCount={deletionCount}
          checkedCount={checkedIds.length}
          isRunning={isRunning}
          actionButtonLabel={actionButtonLabel}
          actionButtonDisabled={actionButtonDisabled}
          promptSyncSummary={promptSyncSummary}
          handleMarkCheckedForDeletion={handleMarkCheckedForDeletion}
          jobStatus={jobStatus}
          jobDone={jobDone}
          jobSkip={jobSkip}
          jobFail={jobFail}
          jobTotal={jobTotal}
        />
      )}

      <DeviceSyncPreSyncModal
        preSyncOpen={preSyncOpen}
        preSyncLoading={preSyncLoading}
        syncDelta={syncDelta}
        onCancel={() => setPreSyncOpen(false)}
        onProceed={handleSyncExecution}
      />

      <DeviceSyncMigrationModal
        migrationPhase={migrationPhase}
        migrationOldTemplate={migrationOldTemplate}
        migrationPairs={migrationPairs}
        migrationCollisions={migrationCollisions}
        migrationUnchanged={migrationUnchanged}
        migrationResult={migrationResult}
        executeMigration={executeMigration}
        closeMigration={closeMigration}
      />
    </div>
  );
}
