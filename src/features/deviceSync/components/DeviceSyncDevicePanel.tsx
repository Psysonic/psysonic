import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2, Clock, Disc3, ListMusic, Loader2, Trash2, Undo2, Users,
} from 'lucide-react';
import { deviceSyncSourceKey, type DeviceSyncSource } from '@/features/deviceSync/store/deviceSyncStore';
import type { SyncStatus } from '@/features/deviceSync/utils/deviceSyncHelpers';

interface Props {
  sources: DeviceSyncSource[];
  sourceStatuses: Map<string, SyncStatus>;
  driveDetected: boolean;
  scanning: boolean;
  checkedIds: string[];
  toggleChecked: (id: string) => void;
  allChecked: boolean;
  toggleAll: () => void;
  isRunning: boolean;
  handleToggleSource: (source: DeviceSyncSource) => void;
  markForDeletion: (ids: string[]) => void;
  unmarkDeletion: (id: string) => void;
}

const TYPE_ICONS: Record<DeviceSyncSource['type'], React.ReactNode> = {
  album: <Disc3 size={16} aria-hidden="true" />,
  playlist: <ListMusic size={16} aria-hidden="true" />,
  artist: <Users size={16} aria-hidden="true" />,
};

const TYPE_LABEL_KEYS: Record<DeviceSyncSource['type'], string> = {
  album: 'deviceSync.typeAlbum',
  playlist: 'deviceSync.typePlaylist',
  artist: 'deviceSync.typeArtist',
};

const STATUS_LABEL_KEYS: Record<SyncStatus, string> = {
  synced: 'deviceSync.statusSynced',
  pending: 'deviceSync.statusPending',
  deletion: 'deviceSync.statusDeletion',
};

const STATUS_ICONS: Record<SyncStatus, React.ReactNode> = {
  synced: <CheckCircle2 size={12} aria-hidden="true" />,
  pending: <Clock size={12} aria-hidden="true" />,
  deletion: <Trash2 size={12} aria-hidden="true" />,
};

/** Step 3: what is (or will be) on the device. */
export default function DeviceSyncDevicePanel({
  sources, sourceStatuses, driveDetected, scanning,
  checkedIds, toggleChecked, allChecked, toggleAll,
  isRunning, handleToggleSource, markForDeletion, unmarkDeletion,
}: Props) {
  const { t } = useTranslation();

  let notice: string | null = null;
  if (!driveDetected) notice = t('deviceSync.targetMissing');
  else if (sources.length === 0) notice = t('deviceSync.noSourcesSelected');

  return (
    <section className="device-sync-panel device-sync-device-panel" aria-labelledby="device-sync-device-title">
      <div className="device-sync-panel-head">
        <h2 id="device-sync-device-title" className="device-sync-step-title">
          <span className="device-sync-step-num" aria-hidden="true">3</span>
          {t('deviceSync.onDeviceTitle')}
          {sources.length > 0 && <span className="device-sync-step-count">{sources.length}</span>}
          {scanning && <Loader2 size={13} className="spin" aria-label={t('deviceSync.scanningDevice')} />}
        </h2>
        {!notice && (
          <label className="device-sync-select-all">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={isRunning} />
            {t('deviceSync.selectAll')}
          </label>
        )}
      </div>

      {notice ? (
        <p className="device-sync-panel-notice">{notice}</p>
      ) : (
        <ul className="device-sync-device-list">
          {sources.map(source => {
            const sourceKey = deviceSyncSourceKey(source);
            const status = sourceStatuses.get(sourceKey) ?? 'pending';
            const checked = checkedIds.includes(sourceKey);
            const secondary = source.type === 'album' && source.artist
              ? source.artist
              : t(TYPE_LABEL_KEYS[source.type]);
            return (
              <li key={sourceKey} className={`device-sync-device-row ${status}${checked ? ' checked' : ''}`}>
                <label className="device-sync-row-main">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleChecked(sourceKey)}
                    disabled={isRunning || status === 'deletion'}
                  />
                  <span className="device-sync-row-type" title={t(TYPE_LABEL_KEYS[source.type])}>
                    {TYPE_ICONS[source.type]}
                  </span>
                  <span className="device-sync-row-text">
                    <span className="device-sync-row-title">{source.name}</span>
                    <span className="device-sync-row-sub">{secondary}</span>
                  </span>
                </label>
                <span className={`device-sync-status-chip ${status}`}>
                  {STATUS_ICONS[status]}{t(STATUS_LABEL_KEYS[status])}
                </span>
                {status === 'deletion' ? (
                  <button
                    type="button"
                    className="device-sync-action-btn undo"
                    onClick={() => unmarkDeletion(sourceKey)}
                    disabled={isRunning}
                    aria-label={`${t('deviceSync.undoDeletion')}: ${source.name}`}
                    data-tooltip={t('deviceSync.undoDeletion')}
                  >
                    <Undo2 size={15} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`device-sync-action-btn ${status === 'synced' ? 'danger' : 'muted'}`}
                    onClick={() => (status === 'synced'
                      ? markForDeletion([sourceKey])
                      : handleToggleSource(source))}
                    disabled={isRunning}
                    aria-label={`${t(status === 'synced' ? 'deviceSync.markForDeletion' : 'deviceSync.removeSource')}: ${source.name}`}
                    data-tooltip={t(status === 'synced' ? 'deviceSync.markForDeletion' : 'deviceSync.removeSource')}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
