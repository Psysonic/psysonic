import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-shell';
import {
  AlertCircle,
  ChevronDown,
  Copy,
  Download,
  Eye,
  ExternalLink,
  Link2,
  ListPlus,
  Loader2,
  Play,
  RadioTower,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SubsonicShare } from '@/lib/api/subsonicSharing';
import { serverListDisplayLabel } from '@/lib/server/serverDisplayName';
import { useServerReachabilitySnapshot } from '@/lib/network/serverReachability';
import { useAuthStore } from '@/store/authStore';
import { useConfirmModalStore } from '@/store/confirmModalStore';
import { useShareStore, type ServerShareState } from '@/features/share/store/shareStore';
import { aggregateShareCount } from '@/features/share/shareNavigation';
import {
  shareResourceCount,
  shareResourceKindLabel,
  shareResourceSummary,
} from '@/features/share/sharePresentation';
import { outboundShareUnavailableHelp } from '@/features/share/outboundShare';
import { useShareSettingsStore } from '@/features/share/store/shareSettingsStore';
import ShareContentsModal from '@/features/share/components/ShareContentsModal';
import ShareArtworkRail from '@/features/share/components/ShareArtworkRail';
import { loadShareSongs } from '@/features/share/loadShareSongs';
import { usePlayerStore } from '@/features/playback';
import { songToTrack } from '@/lib/media/songToTrack';
import { copyTextToClipboard } from '@/lib/server/serverMagicString';
import { deriveLibraryBrowseServerIdsWithFallback } from '@/lib/library/libraryBrowseScope';
import { showToast } from '@/lib/dom/toast';
import { tooltipAttrs } from '@/ui/tooltipAttrs';
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
  const activeServerId = useAuthStore(state => state.activeServerId);
  const libraryBrowseServerIds = useAuthStore(state => state.libraryBrowseServerIds);
  const byServer = useShareStore(state => state.byServer);
  const refreshAll = useShareStore(state => state.refreshAll);
  const refreshServer = useShareStore(state => state.refreshServer);
  const deleteShare = useShareStore(state => state.deleteShare);
  const visibleServerIds = deriveLibraryBrowseServerIdsWithFallback({
    servers,
    activeServerId,
    libraryBrowseServerIds,
  });
  const visibleServerIdSet = new Set(visibleServerIds);
  const visibleServers = servers.filter(server => visibleServerIdSet.has(server.id));
  const totalShares = useShareStore(state => aggregateShareCount(state, visibleServerIds));
  const navidromeSharingEnabled = useShareSettingsStore(state => state.navidromeSharingEnabled);
  const collapsedServerIds = useShareSettingsStore(state => state.collapsedServerIds);
  const toggleServerCollapsed = useShareSettingsStore(state => state.toggleServerCollapsed);
  const reachability = useServerReachabilitySnapshot();
  const [busyRows, setBusyRows] = useState<Set<string>>(() => new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [selectedContents, setSelectedContents] = useState<{
    serverId: string;
    share: SubsonicShare;
    title?: string;
  } | null>(null);
  const browseScopeKey = visibleServerIds.join('\u0001');
  const anyLoading = visibleServerIds.some(serverId => byServer[serverId]?.loading);
  useEffect(() => {
    if (navidromeSharingEnabled) void refreshAll();
  }, [browseScopeKey, navidromeSharingEnabled, refreshAll]);

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
      showToast(t('shared.copied'), 2_500, 'success');
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

  const runPlaybackAction = async (
    serverId: string,
    share: SubsonicShare,
    action: 'play' | 'queue',
  ) => {
    const key = `${serverId}:${share.id}:${action}`;
    setRowBusy(key, true);
    setActionErrors(current => {
      const next = { ...current };
      delete next[`${serverId}:${share.id}`];
      return next;
    });
    try {
      const { songs } = await loadShareSongs(serverId, share);
      if (songs.length === 0) throw new Error(t('shared.contentsEmpty'));
      const tracks = songs.map(songToTrack);
      if (action === 'play') usePlayerStore.getState().playTrack(tracks[0]!, tracks);
      else usePlayerStore.getState().enqueue(tracks);
    } catch (err) {
      setActionErrors(current => ({
        ...current,
        [`${serverId}:${share.id}`]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setRowBusy(key, false);
    }
  };

  const pageHeader = (
    <header className="shared-page__header">
      <div className="shared-page__intro">
        <h1 className="page-title">{t('sidebar.shared')}</h1>
        {!navidromeSharingEnabled && <p>{t('shared.navidromeSharingDesc')}</p>}
        {navidromeSharingEnabled && (
          <span className="shared-page__total"><Link2 size={13} aria-hidden="true" />{t('shared.links', { count: totalShares })}</span>
        )}
      </div>
      {navidromeSharingEnabled && (
        <button type="button" className="btn btn-primary shared-page__refresh" onClick={() => void refreshAll()}>
          <RefreshCw size={16} className={anyLoading ? 'spin' : undefined} aria-hidden="true" />
          {t('shared.refreshAll')}
        </button>
      )}
    </header>
  );

  if (!navidromeSharingEnabled) {
    return (
      <section className="shared-page">
        {pageHeader}
        <div className="shared-page__integration-state">
          <div className="shared-page__integration-icon" aria-hidden="true">
            <RadioTower size={24} />
          </div>
          <div>
            <strong>{t('shared.navidromeSharingTitle')}</strong>
            <span>{t('shared.navidromeSharingDesc')}</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="shared-page"
      data-benchmark-loading={anyLoading ? 'true' : 'false'}
    >
      {pageHeader}

      <div className="shared-page__servers">
        {visibleServers.map(server => {
          const state = byServer[server.id];
          const status = statusContent(state, reachability.get(server.id) === 'unavailable', t);
          const serverLabel = serverListDisplayLabel(server, servers);
          const collapsed = Boolean(collapsedServerIds[server.id]);
          const contentId = `shared-server-content-${server.id}`;
          return (
            <section className={`shared-server${collapsed ? ' shared-server--collapsed' : ''}`} key={server.id} aria-labelledby={`shared-server-${server.id}`}>
              <header className="shared-server__header">
                <div className="shared-server__identity">
                  <span className="shared-server__icon" aria-hidden="true"><RadioTower size={18} /></span>
                  <div>
                    <h2 id={`shared-server-${server.id}`}>{serverLabel}</h2>
                    <span>{t('shared.links', { count: state?.shares.length ?? 0 })}</span>
                  </div>
                </div>
                <div className="shared-server__controls">
                  <button
                    type="button"
                    className="btn btn-surface btn-sm shared-server__refresh"
                    disabled={state?.loading}
                    onClick={() => void refreshServer(server.id).catch(() => {})}
                    aria-label={t('shared.refreshServerLabel', { server: serverLabel })}
                  >
                    {state?.loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                    {t('shared.refresh')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-surface btn-sm shared-server__collapse"
                    aria-labelledby={`shared-server-${server.id}`}
                    aria-expanded={!collapsed}
                    aria-controls={contentId}
                    onClick={() => toggleServerCollapsed(server.id)}
                  >
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </div>
              </header>

              <div id={contentId} hidden={collapsed}>
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
                        const resourceCount = shareResourceCount(share);
                        return (
                          <article className="shared-link" key={share.id}>
                            <div className="shared-link__mark" aria-hidden="true"><Link2 size={18} /></div>
                            <div className="shared-link__body">
                              {resourceCount > 0 ? (
                                <button
                                  type="button"
                                  className="shared-link__summary"
                                  aria-label={`${shareResourceKindLabel(share, t)} ${shareResourceSummary(share, t)}`}
                                  onClick={() => setSelectedContents({ serverId: server.id, share })}
                                >
                                  <span className="shared-link__summary-type">{shareResourceKindLabel(share, t)}</span>
                                  <span>{shareResourceSummary(share, t)}</span>
                                </button>
                              ) : (
                                <div className="shared-link__summary shared-link__summary--static">
                                  <span className="shared-link__summary-type">{shareResourceKindLabel(share, t)}</span>
                                  <span>{shareResourceSummary(share, t)}</span>
                                </div>
                              )}
                              <dl className="shared-link__meta">
                                {share.username && <div><dt>{t('shared.owner')}</dt><dd>{share.username}</dd></div>}
                                {created && <div><dt>{t('shared.created')}</dt><dd>{created}</dd></div>}
                                {expires && <div><dt>{t('shared.expires')}</dt><dd>{expires}</dd></div>}
                                {lastVisited && <div><dt>{t('shared.lastOpened')}</dt><dd>{lastVisited}</dd></div>}
                                {typeof share.visitCount === 'number' && (
                                  <div {...tooltipAttrs(`${t('shared.visits')}: ${share.visitCount}`)}>
                                    <dt className="visually-hidden">{t('shared.visits')}</dt>
                                    <dd><Eye size={13} aria-hidden="true" />{share.visitCount}</dd>
                                  </div>
                                )}
                                {share.downloadable === true && (
                                  <div
                                    className="shared-link__download-indicator"
                                    {...tooltipAttrs(`${t('shared.downloads')}: ${t('shared.allowed')}`)}
                                  >
                                    <dt className="visually-hidden">{t('shared.downloads')}</dt>
                                    <dd><Download size={13} aria-hidden="true" /></dd>
                                  </div>
                                )}
                              </dl>
                              <ShareArtworkRail
                                serverId={server.id}
                                share={share}
                                onOpen={(entries, title) => setSelectedContents({
                                  serverId: server.id,
                                  share: { ...share, resourceKind: undefined, entry: entries },
                                  title,
                                })}
                              />
                              {actionErrors[rowKey] && <div className="shared-link__error" role="alert">{actionErrors[rowKey]}</div>}
                            </div>
                            <div className="shared-link__actions">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm shared-link__action"
                                disabled={busyRows.has(`${rowKey}:play`)}
                                onClick={() => void runPlaybackAction(server.id, share, 'play')}
                              >
                                {busyRows.has(`${rowKey}:play`) ? <Loader2 size={14} className="spin" /> : <Play size={14} fill="currentColor" />}
                                {t('common.play')}
                              </button>
                              <button
                                type="button"
                                className="btn btn-surface btn-sm shared-link__action"
                                disabled={busyRows.has(`${rowKey}:queue`)}
                                onClick={() => void runPlaybackAction(server.id, share, 'queue')}
                              >
                                {busyRows.has(`${rowKey}:queue`) ? <Loader2 size={14} className="spin" /> : <ListPlus size={14} />}
                                {t('common.addToQueue')}
                              </button>
                              <button type="button" className="btn btn-surface btn-sm shared-link__action" onClick={() => void copyShare(server.id, share)}>
                                <Copy size={14} /> {t('shared.copy')}
                              </button>
                              <button
                                type="button"
                                className="btn btn-surface btn-sm shared-link__action"
                                onClick={() => void open(share.url).catch(err => setActionErrors(current => ({
                                  ...current,
                                  [rowKey]: String(err),
                                })))}
                              >
                                <ExternalLink size={14} /> {t('shared.openExternal')}
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm shared-link__action"
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
              </div>
            </section>
          );
        })}
      </div>
      {selectedContents && (
        <ShareContentsModal
          key={`${selectedContents.serverId}:${selectedContents.share.id}`}
          open
          serverId={selectedContents.serverId}
          share={selectedContents.share}
          title={selectedContents.title}
          onClose={() => setSelectedContents(null)}
        />
      )}
    </section>
  );
}
