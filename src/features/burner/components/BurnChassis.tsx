import { useTranslation } from 'react-i18next';
import type { BurnMediaInfo, BurnRecorder } from '@/lib/api/burn';
import { isExpanded, type BurnStage } from '@/features/burner/utils/burnStage';
import RecorderPicker from '@/features/burner/components/RecorderPicker';

export interface BurnChassisProps {
  stage: BurnStage;
  discTitle: string;
  onDiscTitleChange: (title: string) => void;
  /** The mode the next burn will run in, from the options column. */
  testWrite: boolean;
  /** The mode the job that is running now actually committed to. */
  jobTestWrite: boolean;
  supported: boolean;
  recorders: BurnRecorder[];
  selectedId: string;
  onSelect: (id: string) => void;
  media: BurnMediaInfo | null;
  loading: boolean;
  onRefresh: () => void;
  onErase: () => void;
  onReload: () => void;
  busy: boolean;
  /** True when the media blocker is the message the alert line is showing. */
  showReloadLabel?: boolean;
}

interface ModePill {
  key: string;
  tone: string;
}

/**
 * What the strip says about the mode.
 *
 * A rehearsal keeps saying so all the way through, because a job that reports
 * sectors with the laser off is precisely the one a person can misread as a
 * burn. Only a real commit earns the loud one.
 */
function modePillFor(stage: BurnStage, testWrite: boolean, jobTestWrite: boolean): ModePill | null {
  if (stage === 'committing') {
    return jobTestWrite
      ? { key: 'burner.pillRehearsal', tone: 'is-rehearsal' }
      : { key: 'burner.pillWriting', tone: 'is-writing' };
  }
  if (stage === 'building' && testWrite) {
    return { key: 'burner.pillRehearsal', tone: 'is-rehearsal' };
  }
  return null;
}

/**
 * The head of the machine: what you are making, and what you are making it on.
 *
 * These were two bordered strips twelve pixels apart, which is the stack-of-
 * cards tell — they are one fact about one disc and they read as one. The
 * drive row is hidden by the stylesheet once the page is expanded rather than
 * disabled: every control in it is already unusable while a job holds the
 * drive, so `display: none` retires a dead surface, taking it out of the tab
 * order and the accessibility tree without an `inert` dependency.
 */
export default function BurnChassis({
  stage,
  discTitle,
  onDiscTitleChange,
  testWrite,
  jobTestWrite,
  supported,
  recorders,
  selectedId,
  onSelect,
  media,
  loading,
  onRefresh,
  onErase,
  onReload,
  busy,
  showReloadLabel = false,
}: BurnChassisProps) {
  const { t } = useTranslation();
  const expanded = isExpanded(stage);
  const pill = modePillFor(stage, testWrite, jobTestWrite);
  const written = discTitle.trim();

  return (
    <header className="burner-chassis">
      <div className="burner-chassis-title">
        <h1>{t('burner.title')}</h1>

        {/* Once a disc is being written its name is a fact about it rather than
            a field, and an unnamed disc has no fact to state. */}
        {expanded
          ? written !== '' && <span className="burner-chassis-title-static">{written}</span>
          : (
            <input
              className="burner-disc-title"
              value={discTitle}
              onChange={event => onDiscTitleChange(event.target.value)}
              placeholder={t('burner.discTitlePlaceholder')}
              aria-label={t('burner.discTitleLabel')}
            />
          )}

        {pill && <span className={`burner-mode-pill ${pill.tone}`}>{t(pill.key)}</span>}
      </div>

      {supported && (
        <div className="burner-chassis-drive">
          <RecorderPicker
            recorders={recorders}
            selectedId={selectedId}
            onSelect={onSelect}
            media={media}
            loading={loading}
            onRefresh={onRefresh}
            onErase={onErase}
            onReload={onReload}
            disabled={busy}
            showReloadLabel={showReloadLabel}
          />
        </div>
      )}
    </header>
  );
}
