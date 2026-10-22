import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronDown, Settings2 } from 'lucide-react';
import CustomSelect from '@/ui/CustomSelect';
import {
  DEVICE_SYNC_TRANSCODE_BITRATES,
  useDeviceSyncStore,
  type DeviceSyncLayoutMode,
  type DeviceSyncPlaylistPathMode,
  type DeviceSyncTranscode,
  type DeviceSyncTranscodeFormat,
} from '@/features/deviceSync/store/deviceSyncStore';

interface Props {
  layoutMode: DeviceSyncLayoutMode;
  playlistPathMode: DeviceSyncPlaylistPathMode;
  setLayoutMode: (mode: DeviceSyncLayoutMode) => void;
  setPlaylistPathMode: (mode: DeviceSyncPlaylistPathMode) => void;
  transcode: DeviceSyncTranscode;
  setTranscode: (transcode: DeviceSyncTranscode) => void;
  targetIsLocal: boolean;
  isRunning: boolean;
  showMigrate: boolean;
  startMigrationPreview: () => Promise<void>;
}

const LAYOUT_LABEL_KEYS: Record<DeviceSyncLayoutMode, string> = {
  'self-contained': 'deviceSync.playlistStorageSelfContained',
  'shared-album-tree': 'deviceSync.playlistStorageShared',
  flat: 'deviceSync.layoutFlat',
};

const LAYOUT_HINT_KEYS: Record<DeviceSyncLayoutMode, string> = {
  'self-contained': 'deviceSync.selfContainedLayoutHint',
  'shared-album-tree': 'deviceSync.sharedLayoutHint',
  flat: 'deviceSync.flatLayoutHint',
};

const PATH_STYLE_LABEL_KEYS: Record<DeviceSyncPlaylistPathMode, string> = {
  'playlist-relative': 'deviceSync.playlistPathRelative',
  'device-rooted': 'deviceSync.playlistPathRooted',
  absolute: 'deviceSync.playlistPathAbsolute',
};

const TRANSCODE_FORMAT_LABEL_KEYS: Record<DeviceSyncTranscodeFormat, string> = {
  original: 'deviceSync.transcodeOriginal',
  mp3: 'deviceSync.transcodeMp3',
  aac: 'deviceSync.transcodeAac',
  opus: 'deviceSync.transcodeOpus',
};

/** Where a track lands on the device, mirroring `build_track_path` in syncfs. */
function examplePaths(layoutMode: DeviceSyncLayoutMode, t: TFunction): string[] {
  const artist = t('deviceSync.exampleArtist');
  const album = t('deviceSync.exampleAlbum');
  const title = t('deviceSync.exampleTitle');
  if (layoutMode === 'flat') return [`${artist} - ${album} - 01 - ${title}.flac`];
  const albumPath = `${artist}/${album}/01 - ${title}.flac`;
  if (layoutMode === 'shared-album-tree') return [albumPath];
  const playlist = t('deviceSync.examplePlaylist');
  return [albumPath, `Playlists/${playlist}/01 - ${artist} - ${title}.flac`];
}

/** Collapsible device options; set once per device, so closed by default. */
export default function DeviceSyncOptions({
  layoutMode, playlistPathMode, setLayoutMode, setPlaylistPathMode,
  transcode, setTranscode, targetIsLocal, isRunning,
  showMigrate, startMigrationPreview,
}: Props) {
  const { t } = useTranslation();
  const expanded = useDeviceSyncStore(s => s.optionsExpanded);
  const setExpanded = useDeviceSyncStore(s => s.setOptionsExpanded);
  const bodyId = useId();

  // Self-contained playlists sit next to their files, so only absolute paths
  // change anything there.
  const pathStyles: DeviceSyncPlaylistPathMode[] = [
    'playlist-relative',
    ...(layoutMode !== 'self-contained' || playlistPathMode === 'device-rooted'
      ? ['device-rooted' as const]
      : []),
    'absolute',
  ];
  const formatLabel = transcode.format === 'original'
    ? t(TRANSCODE_FORMAT_LABEL_KEYS.original)
    : `${t(TRANSCODE_FORMAT_LABEL_KEYS[transcode.format])} ${transcode.maxBitRateKbps === 0
      ? t('deviceSync.transcodeBitrateServer')
      : t('deviceSync.transcodeBitrateValue', { kbps: transcode.maxBitRateKbps })}`;
  const summary = [
    t(LAYOUT_LABEL_KEYS[layoutMode]),
    formatLabel,
    t(PATH_STYLE_LABEL_KEYS[playlistPathMode]),
  ].join(' · ');

  return (
    <section className="device-sync-options">
      <button
        type="button"
        className="device-sync-options-toggle"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded(!expanded)}
      >
        <Settings2 size={16} aria-hidden="true" />
        <span className="device-sync-options-label">{t('deviceSync.optionsTitle')}</span>
        <span className="device-sync-options-summary">{summary}</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`device-sync-options-chevron${expanded ? ' open' : ''}`}
        />
      </button>
      {expanded && (
        <div id={bodyId} className="device-sync-options-body">
          <div className="device-sync-field">
            <span className="device-sync-field-label">
              {t('deviceSync.layout')}
            </span>
            <CustomSelect
              className="input device-sync-field-select"
              value={layoutMode}
              onChange={value => setLayoutMode(value as DeviceSyncLayoutMode)}
              disabled={isRunning}
              ariaLabel={t('deviceSync.layout')}
              options={(Object.keys(LAYOUT_LABEL_KEYS) as DeviceSyncLayoutMode[]).map(mode => ({
                value: mode,
                label: t(LAYOUT_LABEL_KEYS[mode]),
              }))}
            />
            <p className="device-sync-field-hint">{t(LAYOUT_HINT_KEYS[layoutMode])}</p>
            <div className="device-sync-path-example">
              <span>{t('deviceSync.pathExampleLabel')}</span>
              {examplePaths(layoutMode, t).map(path => <code key={path}>{path}</code>)}
            </div>
          </div>

          <div className="device-sync-field">
            <span className="device-sync-field-label">
              {t('deviceSync.transcodeFormat')}
            </span>
            <div className="device-sync-field-row">
              <CustomSelect
                className="input device-sync-field-select"
                value={transcode.format}
                onChange={value => setTranscode({ ...transcode, format: value as DeviceSyncTranscodeFormat })}
                disabled={isRunning}
                ariaLabel={t('deviceSync.transcodeFormat')}
                options={(Object.keys(TRANSCODE_FORMAT_LABEL_KEYS) as DeviceSyncTranscodeFormat[]).map(format => ({
                  value: format,
                  label: t(TRANSCODE_FORMAT_LABEL_KEYS[format]),
                }))}
              />
              {transcode.format !== 'original' && (
                <CustomSelect
                  className="input device-sync-field-select"
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
              )}
            </div>
            {transcode.format !== 'original' && (
              <p className="device-sync-field-hint">{t('deviceSync.transcodeHint')}</p>
            )}
          </div>

          <div className="device-sync-field">
            <span className="device-sync-field-label">
              {t('deviceSync.playlistPathStyle')}
            </span>
            <CustomSelect
              className="input device-sync-field-select"
              value={playlistPathMode}
              onChange={value => setPlaylistPathMode(value as DeviceSyncPlaylistPathMode)}
              disabled={isRunning}
              ariaLabel={t('deviceSync.playlistPathStyle')}
              options={pathStyles.map(mode => ({ value: mode, label: t(PATH_STYLE_LABEL_KEYS[mode]) }))}
            />
            {playlistPathMode === 'absolute' && (
              <p className="device-sync-field-hint">{t('deviceSync.playlistPathAbsoluteHint')}</p>
            )}
          </div>

          {targetIsLocal && (
            <p className="device-sync-field-hint device-sync-options-note">{t('deviceSync.localTargetHint')}</p>
          )}
          {showMigrate && (
            <button
              type="button"
              className="btn btn-ghost device-sync-migrate-btn"
              onClick={startMigrationPreview}
              disabled={isRunning}
              data-tooltip={t('deviceSync.migrateTooltip')}
              data-tooltip-pos="bottom"
            >
              {t('deviceSync.migrateButton')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
