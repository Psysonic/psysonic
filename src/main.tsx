import { StrictMode } from 'react';
import ReactDOM, { type Root } from 'react-dom/client';
import i18n from '@/lib/i18n';
import { getWindowKind } from './app/windowKind';
import {
  observeNavidromeCanonicalSuccessfulPing,
  runNavidromeCanonicalMigrationCoordinator,
  type NavidromeCanonicalMigrationProgress,
} from './app/migrations/navidromeCanonicalCoordinator';
import { installNavidromeCanonicalWindowGate } from './app/migrations/navidromeCanonicalWindowGate';
import { dismissStartupSplash } from './app/startupSplash';
import {
  installImportedBackupCoordinator,
} from '@/features/settings/utils/backup';
import { reconcileFullBackupImportRecoveryForWindow } from './app/fullBackupRecoveryStartup';
import {
  armNavidromeCanonicalBackupImport,
  captureNavidromeCanonicalBackupRecoveryState,
  disarmNavidromeCanonicalBackupImport,
  normalizeNavidromeCanonicalBackupStores,
  prepareNavidromeCanonicalDatabaseImport,
  restoreNavidromeCanonicalBackupRecoveryState,
} from './app/migrations/navidromeCanonicalBackup';
import {
  installNavidromeCanonicalHistoryNormalizer,
  rewriteNavidromeCanonicalHistoryForReadyServers,
} from './app/migrations/navidromeCanonicalHistory';
import './styles/themes/index.css';
import './styles/layout/index.css';
import './styles/components/index.css';
import './styles/tracks/index.css';

const rootElement = document.getElementById('root')!;
let applicationRoot: Root | null = null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]!);
}

function migrationStepLabel(step: string | null | undefined): string {
  if (!step) return i18n.t('migration.working');
  return i18n.t(`migration.steps.${step}`, { defaultValue: step });
}

function renderMigrationShell(
  progress?: NavidromeCanonicalMigrationProgress,
  error?: unknown,
): void {
  if (error || (progress && progress.phase !== 'probing' && progress.phase !== 'idle')) {
    dismissStartupSplash();
  }
  const phase = progress?.phase === 'probing' ? i18n.t('migration.preparing') : i18n.t('migration.migrating');
  const detail = error
    ? String(error instanceof Error ? error.message : error).slice(0, 500)
    : migrationStepLabel(progress?.step);
  const formatter = new Intl.NumberFormat(i18n.language);
  const progressText = progress && progress.total > 0
    ? `${formatter.format(progress.completed)} / ${formatter.format(progress.total)}`
    : null;
  const showMigrationDetails = !error && progress
    && progress.phase !== 'probing'
    && progress.phase !== 'idle';
  const safeTitle = escapeHtml(error ? i18n.t('migration.failed') : phase);
  const safeDetail = escapeHtml(detail);
  const safeReason = escapeHtml(i18n.t('migration.canonicalIdReason'));
  const serverLabel = progress?.serverName?.trim() || progress?.serverId;
  const safeServer = serverLabel ? escapeHtml(serverLabel) : null;
  const safeVersion = progress?.serverVersion ? escapeHtml(progress.serverVersion) : null;
  const progressMax = progressText && progress ? progress.total : 1;
  const progressValue = progressText && progress
    ? Math.min(progressMax, Math.max(0, progress.completed))
    : 0;
  rootElement.innerHTML = `
    <main class="canonical-migration-shell">
      <section class="canonical-migration-panel" role="${error ? 'alert' : 'status'}" aria-live="${error ? 'assertive' : 'polite'}">
        <h2 class="canonical-migration-title">${safeTitle}</h2>
        ${showMigrationDetails ? `
          <dl class="canonical-migration-details">
            <dt>${escapeHtml(i18n.t('migration.reasonLabel'))}</dt><dd>${safeReason}</dd>
            ${safeServer ? `<dt>${escapeHtml(i18n.t('migration.serverLabel'))}</dt><dd>${safeServer}</dd>` : ''}
            ${safeVersion ? `<dt>${escapeHtml(i18n.t('migration.versionLabel'))}</dt><dd>${safeVersion}</dd>` : ''}
            <dt>${escapeHtml(i18n.t('migration.stepLabel'))}</dt><dd>${safeDetail}</dd>
          </dl>
        ` : `<p class="canonical-migration-detail">${safeDetail}</p>`}
        ${progressText ? `
          <div class="canonical-migration-progress">
            <div class="canonical-migration-progress-label">
              <span id="canonical-migration-progress-label">${escapeHtml(i18n.t('migration.progressLabel'))}</span>
              <span>${escapeHtml(progressText)}</span>
            </div>
            <progress class="canonical-migration-progress-bar" aria-labelledby="canonical-migration-progress-label" aria-valuetext="${escapeHtml(progressText)}" max="${progressMax}" value="${progressValue}">${escapeHtml(progressText)}</progress>
          </div>
        ` : ''}
        ${error ? `
          <div class="canonical-migration-actions">
            <button id="canonical-migration-retry" class="btn-primary">${escapeHtml(i18n.t('migration.retry'))}</button>
            <button id="canonical-migration-copy" class="btn-surface">${escapeHtml(i18n.t('migration.copyDetails'))}</button>
          </div>
        ` : ''}
      </section>
    </main>
  `;
  if (error) {
    const retry = document.getElementById('canonical-migration-retry');
    retry?.addEventListener('click', () => window.location.reload());
    document.getElementById('canonical-migration-copy')?.addEventListener('click', () => {
      void navigator.clipboard.writeText(detail).catch(() => {});
    });
    retry?.focus();
  }
}

function freezeApplication(): void {
  applicationRoot?.unmount();
  applicationRoot = null;
  renderMigrationShell({
    reason: 'navidrome-canonical-ids',
    serverId: null,
    serverName: null,
    serverVersion: null,
    phase: 'pending',
    step: null,
    completed: 0,
    total: 0,
  });
}

async function mountApplication(): Promise<void> {
  const windowKind = getWindowKind();
  const windowGate = installNavidromeCanonicalWindowGate({
    onLock: () => {
      const hadMountedApplication = applicationRoot !== null;
      freezeApplication();
      if (hadMountedApplication) window.location.reload();
    },
    onUnlock: () => {
      if (applicationRoot === null) window.location.reload();
    },
  });
  if (windowKind === 'mini' && windowGate.engageIfActive()) return;
  renderMigrationShell({
    reason: 'navidrome-canonical-ids',
    serverId: null,
    serverName: null,
    serverVersion: null,
    phase: 'probing',
    step: null,
    completed: 0,
    total: 0,
  });
  installImportedBackupCoordinator({
    arm: () => armNavidromeCanonicalBackupImport(),
    disarm: () => disarmNavidromeCanonicalBackupImport(),
    captureRecoveryState: () => captureNavidromeCanonicalBackupRecoveryState(),
    restoreRecoveryState: snapshot => restoreNavidromeCanonicalBackupRecoveryState(snapshot),
    normalizeStores: stores => normalizeNavidromeCanonicalBackupStores(stores),
    prepareDatabaseImport: stores => prepareNavidromeCanonicalDatabaseImport(stores),
  });
  await reconcileFullBackupImportRecoveryForWindow(windowKind);
  const result = await runNavidromeCanonicalMigrationCoordinator({
    windowKind,
    onProgress: progress => renderMigrationShell(progress),
  });
  if (result.blocked) {
    renderMigrationShell({
      reason: 'navidrome-canonical-ids',
      serverId: null,
      serverName: null,
      serverVersion: null,
      phase: 'pending',
      step: null,
      completed: 0,
      total: 0,
    });
    window.setTimeout(() => window.location.reload(), 2_000);
    return;
  }

  rewriteNavidromeCanonicalHistoryForReadyServers();
  installNavidromeCanonicalHistoryNormalizer();

  const { installSuccessfulPingObserver } = await import('@/lib/server/serverEndpoint');
  installSuccessfulPingObserver(async (profile, successfulProbe, isCurrent) => {
    let reloadRequired: boolean;
    try {
      reloadRequired = await observeNavidromeCanonicalSuccessfulPing({
        profile,
        ping: successfulProbe.ping,
        isCurrent,
        beforeAdmission: async () => {
          freezeApplication();
          const [{ useOfflineJobStore }, { waitForAllOfflineTransfers }] = await Promise.all([
            import('@/features/offline/store/offlineJobStore'),
            import('@/features/offline/utils/offlineOperationCoordinator'),
          ]);
          useOfflineJobStore.getState().cancelAllDownloads();
          await waitForAllOfflineTransfers();
        },
      });
    } catch (error) {
      if (applicationRoot === null) renderMigrationShell(undefined, error);
      throw error;
    }
    if (!reloadRequired) return;
    window.location.reload();
    await new Promise<void>(() => {});
  });
  if (windowGate.engageIfActive()) return;

  const [{ runPreReactBootstrap }, { default: App }] = await Promise.all([
    import('./app/bootstrap'),
    import('./App'),
  ]);
  if (windowGate.engageIfActive()) return;
  runPreReactBootstrap();
  if (windowGate.engageIfActive()) return;
  applicationRoot = ReactDOM.createRoot(rootElement);
  applicationRoot.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void mountApplication().catch(error => renderMigrationShell(undefined, error));
