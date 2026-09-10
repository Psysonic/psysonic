import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Disc3, Download, Flame, ListMusic, Square, Trash2 } from 'lucide-react';
import { showToast } from '@/lib/dom/toast';
import OverlayScrollArea from '@/ui/OverlayScrollArea';
import { BURNER_INPAGE_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { libraryGetOfflinePath } from '@/lib/api/library/reads';
import { buildDownloadUrlForServer } from '@/lib/api/subsonicStreamUrl';
import { cancelBurn, eraseDisc, reloadMedia, startBurn, verifyCdText } from '@/lib/api/burn';
import type { BurnTrackInput } from '@/lib/api/burn';
import {
  DEFAULT_80_MIN_SECTORS,
  describeBlocker,
  estimatedDownloadBytes,
  formatBytes,
  formatDuration,
  layoutDisc,
  sectorsToSeconds,
  tracksNeedingDownload,
} from '@/features/burner/utils/capacity';
import { useBurnListStore } from '@/features/burner/store/burnListStore';
import {
  burnJobIsActive,
  burnJobIsCommitted,
  useBurnJobStore,
} from '@/features/burner/store/burnJobStore';
import { useBurnRecorders } from '@/features/burner/hooks/useBurnRecorders';
import DiscRing from '@/features/burner/components/DiscRing';
import BurnTrackList from '@/features/burner/components/BurnTrackList';
import RecorderPicker from '@/features/burner/components/RecorderPicker';
import BurnOptionsPanel, { type BurnSettings } from '@/features/burner/components/BurnOptionsPanel';
import TrackListingModal from '@/features/burner/components/TrackListingModal';

const DEFAULT_SETTINGS: BurnSettings = {
  writeSpeed: null,
  testWrite: false,
  gapless: true,
  normalize: false,
  ejectWhenDone: true,
  // Off until a burn on real hardware has been read back and verified.
  cdText: false,
};

export default function Burner() {
  const { t } = useTranslation();

  const tracks = useBurnListStore(s => s.tracks);
  const discTitle = useBurnListStore(s => s.discTitle);
  const removeTrack = useBurnListStore(s => s.remove);
  const moveTrack = useBurnListStore(s => s.move);
  const reorderTrack = useBurnListStore(s => s.reorder);
  const setLocalPaths = useBurnListStore(s => s.setLocalPaths);
  const setDiscTitle = useBurnListStore(s => s.setDiscTitle);
  const clearList = useBurnListStore(s => s.clear);

  const job = useBurnJobStore();
  const busy = burnJobIsActive(job.status);
  const committed = burnJobIsCommitted(job.status, job.phase);

  // The media poll stands down while a burn holds the drive exclusively.
  const drives = useBurnRecorders(busy);
  const [settings, setSettings] = useState<BurnSettings>(DEFAULT_SETTINGS);
  const [listingOpen, setListingOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [checkingCdText, setCheckingCdText] = useState(false);

  const capacity = drives.media?.capacitySectors || DEFAULT_80_MIN_SECTORS;
  const layout = useMemo(() => layoutDisc(tracks, capacity), [tracks, capacity]);
  const blocker = useMemo(() => describeBlocker(layout, tracks.length), [layout, tracks.length]);
  const needsDownload = useMemo(() => tracksNeedingDownload(tracks), [tracks]);
  const downloadBytes = useMemo(() => estimatedDownloadBytes(tracks), [tracks]);

  // Resolve local files. A cache hit means the burn skips the download for that
  // track entirely; a miss is not a blocker any more — the burn fetches it as
  // its first step — but we resolve up front so the UI can say how much it will
  // pull down before the user commits.
  useEffect(() => {
    const unresolved = tracks.filter(track => track.localPath === undefined);
    if (unresolved.length === 0) return;
    let cancelled = false;

    void (async () => {
      const resolved: Record<string, string | null> = {};
      await Promise.all(unresolved.map(async track => {
        try {
          const dto = await libraryGetOfflinePath(track.serverId, track.trackId);
          resolved[track.key] = dto.missing ? null : (dto.localPath ?? null);
        } catch {
          resolved[track.key] = null;
        }
      }));
      if (!cancelled && Object.keys(resolved).length > 0) setLocalPaths(resolved);
    })();

    return () => { cancelled = true; };
  }, [tracks, setLocalPaths]);

  const patchSettings = useCallback(
    (patch: Partial<BurnSettings>) => setSettings(current => ({ ...current, ...patch })),
    [],
  );

  // What the selected drive says about CD-TEXT, and why, straight from its
  // MMC feature page rather than a guess about the model.
  const selectedRecorder = drives.recorders.find(r => r.id === drives.selectedId);
  const caps = selectedRecorder?.capabilities;
  const cdTextSupported = selectedRecorder?.supportsCdText ?? false;
  const cdTextReason = useMemo(() => {
    if (cdTextSupported) return null;
    if (!selectedRecorder) return null;
    if (!caps?.reported) return t('burner.cdTextNoAnswer');
    if (!caps.sessionAtOnce) return t('burner.cdTextNoSao');
    if (!caps.rwSubchannel) return t('burner.cdTextNoSubchannel');
    return t('burner.cdTextUnavailable');
  }, [cdTextSupported, selectedRecorder, caps, t]);

  // One artist across every track, or null for a compilation.
  const sharedArtist = useMemo(() => {
    const artists = new Set(tracks.map(track => track.artist).filter(Boolean));
    return artists.size === 1 ? [...artists][0] : null;
  }, [tracks]);

  const handleBurn = useCallback(async () => {
    if (!drives.selectedId || blocker) return;

    const payload: BurnTrackInput[] = tracks.map(track => ({
      sourcePath: track.localPath ?? null,
      // Always send the address, even when a local copy exists: the offline
      // cache can evict a file between this click and the render, and Rust
      // re-checks the path before trusting it.
      // `download.view`, never `stream.view` — a transcoded stream would put a
      // lossy copy on a disc that cannot be rewritten.
      downloadUrl: buildDownloadUrlForServer(track.serverId, track.trackId),
      suffix: track.suffix ?? null,
      serverId: track.serverId,
      sizeBytes: track.sizeBytes ?? null,
      title: track.title,
      artist: track.artist,
      durationSec: track.durationSec,
      isrc: null,
    }));

    const jobId = `burn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    useBurnJobStore.getState().start(jobId, layout.totalSectors, settings.testWrite);

    try {
      await startBurn({
        jobId,
        tracks: payload,
        options: {
          recorderId: drives.selectedId,
          writeSpeed: settings.writeSpeed,
          testWrite: settings.testWrite,
          gapless: settings.gapless,
          normalize: settings.normalize,
          ejectWhenDone: settings.ejectWhenDone,
          mediaCatalogNumber: null,
          cdText: settings.cdText && cdTextSupported,
          discTitle: discTitle.trim() || null,
          // The disc performer is only meaningful when one artist owns the
          // whole disc; a mixed compilation says so instead of naming one.
          discPerformer: sharedArtist,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useBurnJobStore.getState().fail(message);
      showToast(message, 8000, 'error');
    }
  }, [drives.selectedId, blocker, tracks, layout.totalSectors, settings, cdTextSupported, discTitle, sharedArtist]);

  const handleCancel = useCallback(async () => {
    if (!job.jobId) return;
    useBurnJobStore.getState().requestCancel();
    const stopped = await cancelBurn({ jobId: job.jobId });
    if (!stopped) useBurnJobStore.getState().cancelRequestFailed();
  }, [job.jobId]);

  const handleCheckCdText = useCallback(async () => {
    if (!drives.selectedId) return;
    setCheckingCdText(true);
    try {
      const result = await verifyCdText({ recorderId: drives.selectedId });
      if (!result.checked) {
        showToast(result.error ?? t('burner.toastCdTextUnreadable'), 9000, 'info');
      } else if (result.packs > 0) {
        showToast(t('burner.checkCdTextFound', { count: result.packs }), 6000, 'info');
      } else {
        showToast(t('burner.checkCdTextAbsent'), 9000, 'info');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 8000, 'error');
    } finally {
      setCheckingCdText(false);
    }
  }, [drives.selectedId, t]);

  // A finished job changes what the drive says about the disc — a real burn
  // fills it, and a rehearsal can leave the drive describing it differently
  // even though nothing was written. Re-probe once on the transition so the
  // media facts are not stale until the user happens to press Refresh.
  const settled = job.status === 'done' || job.status === 'failed' || job.status === 'cancelled';
  const refreshDrives = drives.refresh;
  useEffect(() => {
    if (!settled) return;
    refreshDrives();
  }, [settled, refreshDrives]);

  const handleReload = useCallback(async () => {
    if (!drives.selectedId) return;
    try {
      showToast(t('burner.reloading'), 4000, 'info');
      await reloadMedia({ recorderId: drives.selectedId });
      showToast(t('burner.reloadDone'), 6000, 'info');
      drives.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 8000, 'error');
    }
  }, [drives, t]);

  const handleErase = useCallback(async () => {
    if (!drives.selectedId) return;
    try {
      showToast(t('burner.erasing'), 4000, 'info');
      await eraseDisc({ recorderId: drives.selectedId, quick: true });
      showToast(t('burner.eraseDone'), 5000, 'info');
      drives.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 8000, 'error');
    }
  }, [drives, t]);

  // During the preparation phases Rust reuses the progress counters for
  // "track N of M" — there is no sector position yet, because nothing has been
  // written. Showing those numbers under SECTORS and POSITION would read as
  // disc progress, so the cells stay blank until they actually mean sectors.
  const onDisc = job.phase === 'writing' || job.phase === 'closing';
  const showSectors = onDisc || job.status === 'done';

  const mediaBlocker = drives.media?.blocker ?? null;
  const canBurn =
    drives.supported &&
    !busy &&
    !blocker &&
    !mediaBlocker &&
    Boolean(drives.selectedId);

  return (
    <div className="content-body mainstage-inpage-split burner-page">
      <header className="burner-header">
        <h1>{t('burner.title')}</h1>
        <input
          className="burner-disc-title"
          value={discTitle}
          onChange={event => setDiscTitle(event.target.value)}
          placeholder={t('burner.discTitlePlaceholder')}
          aria-label={t('burner.discTitleLabel')}
          disabled={busy}
        />
      </header>

      {!drives.supported && (
        <div className="burner-banner is-info">
          <Disc3 size={15} aria-hidden="true" />
          <span>{t('burner.platformUnsupported')}</span>
        </div>
      )}

      {drives.supported && (
        <RecorderPicker
          recorders={drives.recorders}
          selectedId={drives.selectedId}
          onSelect={drives.select}
          media={drives.media}
          loading={drives.loading}
          onRefresh={drives.refresh}
          onErase={() => void handleErase()}
          onReload={() => void handleReload()}
          disabled={busy}
        />
      )}

      {mediaBlocker && !busy && (
        <div className="burner-banner is-warn">
          <Disc3 size={15} aria-hidden="true" />
          <span>{mediaBlocker}</span>
        </div>
      )}

      {needsDownload.length > 0 && !busy && (
        <div className="burner-banner">
          <Download size={15} aria-hidden="true" />
          <span>
            {t('burner.willDownload', {
              count: needsDownload.length,
              size: formatBytes(downloadBytes),
            })}
          </span>
        </div>
      )}

      {job.status === 'failed' && job.error && (
        <div className="burner-banner is-error">
          <Disc3 size={15} aria-hidden="true" />
          <span>{job.error}</span>
        </div>
      )}

      <div className="burner-split">
        <section className="burner-stage">
          <DiscRing
            layout={layout}
            hoveredIndex={hoveredIndex}
            onHoverChange={setHoveredIndex}
            phase={job.phase}
            sectorsDone={job.sectorsDone}
            trackIndex={job.trackIndex}
            trackTotal={tracks.length}
            busy={busy}
            testWrite={job.testWrite}
            finished={job.status === 'done'}
          />

          <div className="burner-transport">
            {busy ? (
              <button
                type="button"
                className="burner-btn is-danger"
                onClick={() => void handleCancel()}
                disabled={job.status === 'cancelling'}
                title={committed ? t('burner.cancelSpoilsDisc') : undefined}
              >
                <Square size={14} aria-hidden="true" />
                {job.status === 'cancelling' ? t('burner.cancelling') : t('burner.cancel')}
              </button>
            ) : (
              <button
                type="button"
                className="burner-btn is-primary"
                onClick={() => void handleBurn()}
                disabled={!canBurn}
              >
                <Flame size={14} aria-hidden="true" />
                {settings.testWrite ? t('burner.startTestWrite') : t('burner.startBurn')}
              </button>
            )}

            <button
              type="button"
              className="burner-btn"
              onClick={() => setListingOpen(true)}
              disabled={tracks.length === 0}
            >
              <ListMusic size={14} aria-hidden="true" />
              {t('burner.trackListing')}
            </button>

            <button
              type="button"
              className="burner-btn"
              onClick={clearList}
              disabled={busy || tracks.length === 0}
            >
              <Trash2 size={14} aria-hidden="true" />
              {t('burner.clear')}
            </button>
          </div>

          {blocker && !busy && (
            <p className="burner-blocker">{t(blocker.key, blocker.values)}</p>
          )}
          {committed && (
            <p className="burner-blocker">{t('burner.cancelSpoilsDisc')}</p>
          )}

          {/* Options live under the ring: that column is otherwise dead space
              below a fixed-size disc, and every row it takes here is a row the
              running order gets back. */}
          <div className="burner-panel burner-panel--options">
            <div className="burner-panel-head">
              <h2>{t('burner.options')}</h2>
            </div>
            <BurnOptionsPanel
              settings={settings}
              onChange={patchSettings}
              media={drives.media}
              cdTextSupported={cdTextSupported}
              cdTextReason={cdTextReason}
              onCheckCdText={() => void handleCheckCdText()}
              checkingCdText={checkingCdText}
              disabled={busy}
            />
          </div>
        </section>

        <section className="burner-side">
          <div className="burner-panel burner-panel--list">
            <div className="burner-panel-head">
              <h2>{t('burner.runningOrder')}</h2>
              <span className="burner-panel-meta">
                {t('burner.trackCount', { count: layout.arcs.length })}
                {' · '}
                {t('burner.totalRuntime', {
                  duration: formatDuration(sectorsToSeconds(layout.totalSectors)),
                })}
              </span>
            </div>
            <OverlayScrollArea
              className="burner-list-scroll"
              viewportId={BURNER_INPAGE_SCROLL_VIEWPORT_ID}
            >
              <BurnTrackList
                arcs={layout.arcs}
                hoveredIndex={hoveredIndex}
                onHoverChange={setHoveredIndex}
                onRemove={removeTrack}
                onMove={moveTrack}
                onReorder={reorderTrack}
                activeIndex={busy ? job.trackIndex : null}
                writtenBefore={
                  busy && job.sectorsDone > 0
                    ? layout.arcs.filter(a => job.sectorsDone >= a.startSector + a.sectors).length
                    : 0
                }
                disabled={busy}
              />
            </OverlayScrollArea>
          </div>
        </section>
      </div>

      <dl className="burner-readout">
        <div>
          <dt>{t('burner.readoutPhase')}</dt>
          <dd className="is-accent">
            {job.phase ? t(`burner.phase.${job.phase}`) : t('burner.phaseIdle')}
          </dd>
        </div>
        <div>
          <dt>{t('burner.readoutMode')}</dt>
          <dd>{settings.testWrite ? t('burner.modeTest') : t('burner.modeDao')}</dd>
        </div>
        <div>
          <dt>{t('burner.readoutPosition')}</dt>
          <dd>{showSectors ? job.msf : '—'}</dd>
        </div>
        <div>
          <dt>{t('burner.readoutSectors')}</dt>
          <dd>
            {showSectors
              ? `${job.sectorsDone.toLocaleString()} / ${(job.sectorsTotal || layout.totalSectors).toLocaleString()}`
              : `— / ${layout.totalSectors.toLocaleString()}`}
          </dd>
        </div>
        <div>
          <dt>{t('burner.readoutBuffer')}</dt>
          <dd className="is-good">
            {job.bufferPercent === null ? '—' : `${job.bufferPercent}%`}
          </dd>
        </div>
      </dl>

      <TrackListingModal
        open={listingOpen}
        onClose={() => setListingOpen(false)}
        arcs={layout.arcs}
        discTitle={discTitle}
      />
    </div>
  );
}
