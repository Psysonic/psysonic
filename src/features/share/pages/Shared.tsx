import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-shell';
import { AlertCircle, Copy, ExternalLink, Loader2, RefreshCw, Share2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SubsonicShare } from '@/lib/api/subsonicSharing';
import { serverListDisplayLabel } from '@/lib/server/serverDisplayName';
import { useServerReachabilitySnapshot } from '@/lib/network/serverReachability';
import { useAuthStore } from '@/store/authStore';
import { useConfirmModalStore } from '@/store/confirmModalStore';
import { useShareStore, type ServerShareState } from '@/features/share/store/shareStore';
import { selectAggregateShareCount } from '@/features/share/shareNavigation';
import { shareResourceSummary } from '@/features/share/sharePresentation';
import { outboundShareUnavailableHelp } from '@/features/share/outboundShare';
import { copyTextToClipboard } from '@/lib/server/serverMagicString';
import type { TFunction } from 'i18next';

function formatDate(value: string | undefined, locale: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function statusContent(
  state: ServerShareState | undefined,
  unreachable: boolean,
  t: TFunction,
): { kind: string; title: string; detail?: string } | null {
  if (!state || state.loading || state.availability === 'unknown') {
    return { kind: 'loading', title: t('shared.loading') };
  }
  if (state.availability === 'unsupported') {
    return {
      kind: 'disabled',
      title: t('shared.unavailable'),
      detail: outboundShareUnavailableHelp(state.reason, t),
    };
  }
  if (state.availability === 'sharing_disabled') {
    return { kind: 'disabled', title: t('shared.sharingDisabled'), detail: state.error };
  }
  if (unreachable || state.availability === 'server_unavailable') {
    return { kind: 'unreachable', title: t('shared.serverUnreachable'), detail: state.error };
  }
  if (state.error && state.shares.length === 0) {
    return { kind: 'error', title: t('shared.loadFailed'), detail: state.error };
  }
  if (state.shares.length === 0) {
    return { kind: 'empty', title: t('shared.empty') };
  }
  return null;
}

export default function Shared() {
  const { t, i18n } = useTranslation();
  const servers = useAuthStore(state => state.servers);
  const byServer = useShareStore(state => state.byServer);
  const refreshAll = useShareStore(state => state.refreshAll);
  const refreshServer = useShareStore(state => state.refreshServer);
  const deleteShare = useShareStore(state => state.deleteShare);
  const totalShares = useShareStore(selectAggregateShareCount);
  const reachability = useServerReachabilitySnapshot();
  const [busyRows, setBusyRows] = useState<Set<string>>(() => new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [copiedRow, setCopiedRow] = useState<string | null>(null);
  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const setRowBusy = (key: string, busy: boolean) => {
    setBusyRows(current => {
      const next = new Set(current);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const copyShare = async (serverId: string, share: SubsonicShare) => {
    const key = `${serverId}:${share.id}`;
    try {
      const copied = await copyTextToClipboard(share.url);
      if (!copied) throw new Error(t('contextMenu.shareCopyFailed'));
      setCopiedRow(key);
      window.setTimeout(() => setCopiedRow(current => current === key ? null : current), 1_500);
    } catch (err) {
      setActionErrors(current => ({
        ...current,
        [key]: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const removeShare = async (serverId: string, share: SubsonicShare) => {
    const confirmed = await useConfirmModalStore.getState().request({
      title: t('shared.deleteTitle', { defaultValue: 'Delete shared link?' }),
      message: t('shared.deleteMessage', {
        defaultValue: 'Anyone using this link will lose access. This cannot be undone.',
      }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!confirmed) return;

    const key = `${serverId}:${share.id}`;
    setRowBusy(key, true);
    setActionErrors(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      await deleteShare(serverId, share.id);
    } catch (err) {
      setActionErrors(current => ({
        ...current,
        [key]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setRowBusy(key, false);
    }
  };

  return (
    <section
      className="shared-page"
      data-benchmark-loading={Object.values(byServer).some(state => state.loading) ? 'true' : 'false'}
    >
      <header className="shared-page__header">
        <div>
          <div className="shared-page__title-row">
            <Share2 size={24} aria-hidden="true" />
           <h1>{t('shared.title')}</h1>
            <span className="shared-page__count">{totalShares}</span>
          </div>
          <p>{t('shared.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-surface" onClick={() => void refreshAll()}>
          <RefreshCw size={15} />
          {t('shared.refreshAll')}
        </button>
      </header>

      <div className="shared-page__servers">
        {servers.map(server => {
          const state = byServer[server.id];
          const status = statusContent(state, reachability.get(server.id) === 'unavailable', t);
          const serverLabel = serverListDisplayLabel(server, servers);
          return (
            <section className="shared-server" key={server.id} aria-labelledby={`shared-server-${server.id}`}>
              <header className="shared-server__header">
                <div>
                  <h2 id={`shared-server-${server.id}`}>{serverLabel}</h2>
                  <span>{t('shared.links', { count: state?.shares.length ?? 0 })}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-surface btn-sm"
                  disabled={state?.loading}
                  onClick={() => void refreshServer(server.id).catch(() => {})}
                  aria-label={t('shared.refreshServerLabel', { server: serverLabel })}
                >
                  {state?.loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  {t('shared.refresh')}
                </button>
              </header>

              {status && (
                <div className={`shared-server__state shared-server__state--${status.kind}`}>
                  {status.kind === 'loading' ? <Loader2 size={18} className="spin" /> : <AlertCircle size={18} />}
                  <div><strong>{status.title}</strong>{status.detail && <span>{status.detail}</span>}</div>
                </div>
              )}

              {state && state.shares.length > 0 && (
                <div className="shared-server__list">
                  {state.error && state.availability === 'available' && (
                    <div className="shared-server__inline-error" role="alert">{state.error}</div>
                  )}
                  {state.shares.map(share => {
                    const rowKey = `${server.id}:${share.id}`;
                    const locale = i18n.resolvedLanguage ?? i18n.language;
                    const created = formatDate(share.created, locale);
                    const expires = formatDate(share.expires, locale);
                    const lastVisited = formatDate(share.lastVisited, locale);
                    return (
                      <article className="shared-link" key={share.id}>
                        <div className="shared-link__body">
                          <div className="shared-link__summary">{shareResourceSummary(share, t)}</div>
                          {share.description && <p className="shared-link__description">{share.description}</p>}
                          <dl className="shared-link__meta">
                            {share.username && <><dt>{t('shared.owner')}</dt><dd>{share.username}</dd></>}
                            {created && <><dt>{t('shared.created')}</dt><dd>{created}</dd></>}
                            {expires && <><dt>{t('shared.expires')}</dt><dd>{expires}</dd></>}
                            {lastVisited && <><dt>{t('shared.lastOpened')}</dt><dd>{lastVisited}</dd></>}
                            {typeof share.visitCount === 'number' && <><dt>{t('shared.visits')}</dt><dd>{share.visitCount}</dd></>}
                            {typeof share.downloadable === 'boolean' && <><dt>{t('shared.downloads')}</dt><dd>{share.downloadable ? t('shared.allowed') : t('shared.blocked')}</dd></>}
                          </dl>
                          <span className="shared-link__url">{share.url}</span>
                          {actionErrors[rowKey] && <div className="shared-link__error" role="alert">{actionErrors[rowKey]}</div>}
                          {copiedRow === rowKey && <div className="shared-link__copied" role="status">{t('shared.copied')}</div>}
                        </div>
                        <div className="shared-link__actions">
                          <button type="button" className="btn btn-surface btn-sm" onClick={() => void copyShare(server.id, share)}>
                            <Copy size={14} /> {t('shared.copy')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-surface btn-sm"
                            onClick={() => void open(share.url).catch(err => setActionErrors(current => ({
                              ...current,
                              [rowKey]: String(err),
                            })))}
                          >
                            <ExternalLink size={14} /> {t('shared.openExternal')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busyRows.has(rowKey)}
                            onClick={() => void removeShare(server.id, share)}
                          >
                            {busyRows.has(rowKey) ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                            {t('common.delete')}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
