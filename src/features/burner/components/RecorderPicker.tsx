import { useTranslation } from 'react-i18next';
import { RefreshCw, Disc3, Eraser, ArrowUpFromLine } from 'lucide-react';
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
  onReload: () => void;
  disabled: boolean;
  /**
   * True when the disc's refusal is the message the alert line is showing. The
   * button that answers it then says what it does, so the sentence and the way
   * out of it are not three elements apart.
   */
  showReloadLabel?: boolean;
}

export default function RecorderPicker({
  recorders,
  selectedId,
  onSelect,
  media,
  loading,
  onRefresh,
  onErase,
  onReload,
  disabled,
  showReloadLabel = false,
}: RecorderPickerProps) {
  const { t } = useTranslation();
  const writable = recorders.filter(r => r.canWriteCd);

  return (
    <div className="burner-chassis-drive-inner">
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

      {/* The way out of a stale verdict. Offered exactly when the disc is
          refused and erasing cannot help, which is the case that strands a
          CD-R with nothing to click. */}
      {media?.present && media.blocker !== null && !media.erasable && (
        <button
          type="button"
          className={`burner-icon-btn${showReloadLabel ? ' is-labelled' : ''}`}
          onClick={onReload}
          disabled={disabled}
          title={t('burner.reloadHint')}
          aria-label={t('burner.reloadDisc')}
        >
          <ArrowUpFromLine size={14} aria-hidden="true" />
          {showReloadLabel && <span>{t('burner.reloadDisc')}</span>}
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
      </dl>
    </div>
  );
}
