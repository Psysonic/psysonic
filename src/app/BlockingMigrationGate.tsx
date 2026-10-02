import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { retryBlockingMigration } from '@/app/hooks/useMigrationOrchestrator';
import { useMigrationStore } from '../store/migrationStore';

/** Index backfill steps: their own texts instead of the server-index migration's. */
const INDEX_STEP_TEXT = {
  genreTags: {
    title: 'migration.genreTagsTitle',
    body: 'migration.genreTagsBody',
    failed: 'migration.genreTagsFailed',
  },
  fileMoodTags: {
    title: 'migration.fileMoodTagsTitle',
    body: 'migration.fileMoodTagsBody',
    failed: 'migration.fileMoodTagsFailed',
  },
  recordLabelTags: {
    title: 'migration.recordLabelTagsTitle',
    body: 'migration.recordLabelTagsBody',
    failed: 'migration.recordLabelTagsFailed',
  },
  scopeBrowseProjection: {
    title: 'migration.scopeBrowseProjectionTitle',
    body: 'migration.scopeBrowseProjectionBody',
    failed: 'migration.scopeBrowseProjectionFailed',
  },
} as const;

function MigrationModal() {
  const { t } = useTranslation();
  const phase = useMigrationStore(s => s.phase);
  const step = useMigrationStore(s => s.step);
  const progress = useMigrationStore(s => s.progress);
  const genreTagsProgress = useMigrationStore(s => s.genreTagsProgress);
  const fileMoodTagsProgress = useMigrationStore(s => s.fileMoodTagsProgress);
  const recordLabelTagsProgress = useMigrationStore(s => s.recordLabelTagsProgress);
  const scopeBrowseProjectionProgress = useMigrationStore(s => s.scopeBrowseProjectionProgress);
  const inspect = useMigrationStore(s => s.inspect);
  const error = useMigrationStore(s => s.lastError);
  const stepText = step && step !== 'serverIndex' ? INDEX_STEP_TEXT[step] : null;
  const isTagBackfill = step === 'genreTags' || step === 'fileMoodTags' || step === 'recordLabelTags';
  const migrationTitle = stepText ? t(stepText.title) : t('migration.migrating');
  const migrationBody = stepText
    ? t(stepText.body)
    : (progress ? `${progress.stage} - ${progress.table}` : t('migration.working'));
  const activeProgress = step === 'genreTags'
    ? genreTagsProgress
    : step === 'fileMoodTags'
      ? fileMoodTagsProgress
      : step === 'recordLabelTags'
        ? recordLabelTagsProgress
        : step === 'scopeBrowseProjection'
          ? scopeBrowseProjectionProgress
          : progress;
  const migratedRows = (inspect?.library.totalLegacyRows ?? 0) + (inspect?.analysis.totalLegacyRows ?? 0);
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.65)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
    }}
    >
      <div style={{
        width: 'min(560px, 92vw)',
        background: 'var(--bg-card)',
        borderRadius: 14,
        padding: '1.5rem 1.75rem',
        color: 'var(--text)',
      }}
      >
        {phase === 'inspecting' && (
          <>
            <h3>{stepText ? t(stepText.title) : t('migration.preparing')}</h3>
            <p style={{ color: 'var(--text-muted)' }}>
              {stepText ? t(stepText.body) : t('migration.preparingBody')}
            </p>
          </>
        )}
        {phase === 'running' && (
          <>
            <h3>{migrationTitle}</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              {migrationBody}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>
              {activeProgress ? `${activeProgress.done} / ${activeProgress.total}` : t('migration.working')}
            </p>
            {!isTagBackfill && inspect?.hasSkippedUnknownServerRows ? (
              <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                {t('migration.skippedRows')}
              </p>
            ) : null}
          </>
        )}
        {phase === 'error' && (
          <>
            <h3>{stepText ? t(stepText.failed) : t('migration.failed')}</h3>
            <p style={{ color: 'var(--text-muted)' }}>{String(error ?? '').slice(0, 200)}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn-primary" onClick={() => retryBlockingMigration()}>{t('migration.retry')}</button>
              <button className="btn-surface" onClick={() => navigator.clipboard.writeText(String(error ?? ''))}>
                {t('migration.copyDetails')}
              </button>
            </div>
          </>
        )}
        {phase === 'completed' && (
          <>
            <h3>{t('migration.complete')}</h3>
            <p style={{ color: 'var(--text-muted)' }}>{t('migration.completeRows', { count: migratedRows })}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function BlockingMigrationGate({ children }: { children: ReactNode }) {
  const phase = useMigrationStore(s => s.phase);
  const isBlocking = phase === 'inspecting' || phase === 'running' || phase === 'error';
  return (
    <>
      {children}
      {isBlocking ? <MigrationModal /> : null}
    </>
  );
}
