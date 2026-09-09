import { useTranslation } from 'react-i18next';
import { RefreshCw, Disc3, Eraser } from 'lucide-react';
import type { BurnMediaInfo, BurnRecorder } from '@/lib/api/burn';
import { formatDuration } from '@/features/burner/utils/capacity';
import { sectorsToSeconds } from '@/features/burner/utils/capacity';

export interface RecorderPickerProps {
  recorders: BurnRecorder[];
  selectedId: string;
  onSelect: (id: string) => void;
  media: BurnMediaInfo | null;
  loading: boolean;
  onRefresh: () => void;
  onErase: () => void;
  disabled: boolean;
}

/** Sectors/second → the "×" speed people recognise. 75 sectors/s is 1×. */
function speedLabel(sectorsPerSecond: number): string {
  return `${Math.round(sectorsPerSecond / 75)}×`;
}

export default function RecorderPicker({
  recorders,
  selectedId,
  onSelect,
  media,
  loading,
  onRefresh,
  onErase,
  disabled,
}: RecorderPickerProps) {
  const { t } = useTranslation();
  const writable = recorders.filter(r => r.canWriteCd);

  return (
    <div className="burner-drivebar">
      <label htmlFor="burner-drive">{t('burner.recorder')}</label>
      <select
        id="burner-drive"
        value={selectedId}
        onChange={event => onSelect(event.target.value)}
        disabled={disabled || writable.length === 0}
      >
        {writable.length === 0 && <option value="">{t('burner.noRecorders')}</option>}
        {writable.map(recorder => (
          <option key={recorder.id} value={recorder.id}>
            {recorder.name}
            {recorder.volumePaths.length > 0 ? ` (${recorder.volumePaths[0]})` : ''}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="burner-icon-btn"
        onClick={onRefresh}
        disabled={disabled || loading}
        aria-label={t('burner.refreshDrives')}
        title={t('burner.refreshDrives')}
      >
        <RefreshCw size={14} className={loading ? 'is-spinning' : undefined} aria-hidden="true" />
      </button>

      {media?.erasable && (
        <button
          type="button"
          className="burner-icon-btn"
          onClick={onErase}
          disabled={disabled}
          title={t('burner.eraseDisc')}
          aria-label={t('burner.eraseDisc')}
        >
          <Eraser size={14} aria-hidden="true" />
        </button>
      )}

      <dl className="burner-media-facts">
        <div>
          <dt>{t('burner.mediaLabel')}</dt>
          <dd>
            <Disc3 size={12} aria-hidden="true" />
            {media?.present
              ? `${media.mediaType}${media.blank ? t('burner.mediaBlankSuffix') : ''}`
              : t('burner.noDisc')}
          </dd>
        </div>
        <div>
          <dt>{t('burner.capacityLabel')}</dt>
          <dd>
            {media?.present
              ? t('burner.capacityValue', {
                  minutes: formatDuration(sectorsToSeconds(media.capacitySectors)),
                  sectors: media.capacitySectors.toLocaleString(),
                })
              : '—'}
          </dd>
        </div>
        <div>
          <dt>{t('burner.speedsLabel')}</dt>
          <dd>
            {media && media.writeSpeeds.length > 0
              ? media.writeSpeeds.slice(0, 5).map(speedLabel).join(' · ')
              : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}
