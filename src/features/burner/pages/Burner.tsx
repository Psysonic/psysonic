import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame, ListMusic, Square, Trash2 } from 'lucide-react';
import { showToast } from '@/lib/dom/toast';
import OverlayScrollArea from '@/ui/OverlayScrollArea';
import { BURNER_INPAGE_SCROLL_VIEWPORT_ID } from '@/constants/appScroll';
import { libraryGetOfflinePath } from '@/lib/api/library/reads';
import { buildDownloadUrlForServer } from '@/lib/api/subsonicStreamUrl';
import { cancelBurn, eraseDisc, reloadMedia, startBurn } from '@/lib/api/burn';
import type { BurnTrackInput } from '@/lib/api/burn';
import {
  DEFAULT_80_MIN_SECTORS,
  describeBlocker,
  estimatedDownloadBytes,
  formatDuration,
  layoutDisc,
  sectorsToSeconds,
  tracksNeedingDownload,
} from '@/features/burner/utils/capacity';
import { arcColor } from '@/features/burner/utils/arcColor';
import { ABORT_ARM_MS, burnStageFrom, isExpanded } from '@/features/burner/utils/burnStage';
import { useBurnerSplit } from '@/features/burner/hooks/useBurnerSplit';
import BurnChassis from '@/features/burner/components/BurnChassis';
import BurnAlertLine from '@/features/burner/components/BurnAlertLine';
import BurnSeam from '@/features/burner/components/BurnSeam';
import {
  discGeometry,
  sliceAtAngle,
  tracksBefore,
} from '@/features/burner/utils/discGeometry';
import { useBurnListStore } from '@/features/burner/store/burnListStore';
import {
  burnJobIsActive,
  useBurnJobStore,
  type BurnPhase,
} from '@/features/burner/store/burnJobStore';
import { useBurnRecorders } from '@/features/burner/hooks/useBurnRecorders';
import { useBurnTiming } from '@/features/burner/hooks/useBurnTiming';
import BurnDisc from '@/features/burner/components/BurnDisc';
import BurnMetrics from '@/features/burner/components/BurnMetrics';
import BurnModeSwitch from '@/features/burner/components/BurnModeSwitch';
import BurnStageNote from '@/features/burner/components/BurnStageNote';
import BurnTrackList from '@/features/burner/components/BurnTrackList';
import BurnOptionsPanel, { type BurnSettings } from '@/features/burner/components/BurnOptionsPanel';
import TrackListingModal from '@/features/burner/components/TrackListingModal';

const DEFAULT_SETTINGS: BurnSettings = {
  writeSpeed: null,
  testWrite: false,
  gapless: true,
  normalize: false,
  ejectWhenDone: true,
  // On by default. It was off until a burn had been read back off real
  // hardware; that has now happened on all three platforms, and a disc whose
  // track names a player can show is simply the better disc. A drive that
  // cannot write it turns this off on its own - the value sent to the backend
  // is `settings.cdText && cdTextSupported` - so defaulting to on costs a
  // user with an incapable drive nothing.
  cdText: true,
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
  // Only the laser phases are measurable: fetching and rendering write nothing,
  // so a rate taken from them would describe the wrong thing entirely.
  const writing = busy && (job.phase === 'writing' || job.phase === 'closing');

  // The media poll stands down while a burn holds the drive exclusively.
  const drives = useBurnRecorders(busy);
  const timing = useBurnTiming({
    writing,
    sectorsDone: job.sectorsDone,
    sectorsTotal: job.sectorsTotal,
  });
  const [settings, setSettings] = useState<BurnSettings>(DEFAULT_SETTINGS);
  const [listingOpen, setListingOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const capacity = drives.media?.capacitySectors || DEFAULT_80_MIN_SECTORS;
  const layout = useMemo(
    () => layoutDisc(tracks, capacity, settings.gapless),
    [tracks, capacity, settings.gapless],
  );
  const blocker = useMemo(() => describeBlocker(layout, tracks.length), [layout, tracks.length]);

  // What the page is doing, in the terms the layout cares about. Derived in one
  // place so the disc, the running order and the chrome cannot disagree about
  // whether the drive is committed.
  const stage = burnStageFrom(job.status, job.phase);

  /** The id the abort button points its description at. */
  const COMMIT_WARNING_ID = 'burner-commit-warning';

  // The first track that will not fit. Marked in the list and on the ring
  // rather than only stated in words, so it is obvious which tracks to drop.
  const overrunFrom = useMemo(() => {
    if (layout.fits) return null;
    const at = layout.arcs.findIndex(
      arc => arc.startSector + arc.sectors > layout.capacitySectors,
    );
    return at >= 0 ? at : null;
  }, [layout]);

  // Handed to the running order twice over: drag autoscroll needs the scroller
  // to move, and following the write head needs to know when the user has
  // scrolled it themselves.
  const listViewportRef = useRef<HTMLDivElement>(null);

  // The page carries the resolved width; the split is what gets measured. Every
  // width decision comes from that measurement rather than from the window,
  // because the app shell's sidebar and queue panel mean a wide window can
  // still leave this page narrow.
  const pageRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);

  // Aborting a burn destroys a CD-R, so it takes two presses.
  //
  // What is remembered is the phase it was armed during, not the moment. That
  // makes `armed` a plain comparison during render rather than a clock read,
  // and it disarms on its own when the burn moves on underneath it — the phase
  // changing means the thing the user was about to stop is no longer the thing
  // in front of them.
  const [armedFor, setArmedFor] = useState<BurnPhase | null>(null);
  const armed = armedFor !== null && armedFor === job.phase;

  // And it disarms on a timer as well, rather than waiting to be dismissed: an
  // abort button left armed behind someone who thought better of it is a trap.
  useEffect(() => {
    if (armedFor === null) return;
    const timer = setTimeout(() => setArmedFor(null), ABORT_ARM_MS);
    return () => clearTimeout(timer);
  }, [armedFor]);

  // The timer is cleared the moment writing stops, so how long the burn took
  // has to be caught on the way past or it is gone before it can be shown.
  const elapsedRef = useRef<number | null>(null);
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (writing && timing.elapsedSec !== null) elapsedRef.current = timing.elapsedSec;
  });

  useEffect(() => {
    if (stage === 'settled') setFinalElapsed(elapsedRef.current);
  }, [stage]);

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

  /**
   * Which row is being written.
   *
   * Every backend emits the write phase with no track index - a WRITE(10)
   * reports sectors, not a track - so `job.trackIndex` is null throughout the
   * burn and the list had nothing to mark. The row is found from the sector
   * counter instead, the same way the disc finds the wedge under its head, so
   * the two can never disagree. Fetching and rendering do report an index, and
   * still use it.
   */
  // The ring and the running order are laid out from the same walk, so the row
  // under the head and the wedge under the head cannot disagree. Every backend
  // reports the write phase with no track index at all — the drive knows only
  // sectors — so the row has to be derived from the position.
  const ring = useMemo(
    () => discGeometry(layout.arcs, arcColor, { sectorsDone: onDisc ? job.sectorsDone : 0 }),
    [layout.arcs, onDisc, job.sectorsDone],
  );

  const activeRow = useMemo(() => {
    if (!busy) return null;
    if (!onDisc) return job.trackIndex;
    return sliceAtAngle(ring.slices, ring.progressAngle)?.index ?? null;
  }, [busy, onDisc, job.trackIndex, ring]);

  // Gated on the laser, not merely on the job running. Rendering reports real,
  // growing sector counts for audio that so far exists only as a PCM file, so
  // without this the early rows took a green tick reading "Written to the
  // disc" while nothing had been written at all.
  //
  // A finished burn keeps its ticks. `finish()` nulls the phase, so `onDisc`
  // goes false the instant the job succeeds — which reverted every row from
  // its tick back to a duration at the exact moment the disc was done, beside
  // a ring that `BurnDisc` deliberately paints fully written for the same
  // moment (`finished ? Number.MAX_SAFE_INTEGER`). The two read the same
  // `job.status === 'done'` so they cannot disagree about it; `showSectors`
  // on the next line already makes the same test.
  const writtenRows = useMemo(
    () =>
      job.status === 'done'
        ? ring.slices.length
        : onDisc
          ? tracksBefore(ring.slices, job.sectorsDone)
          : 0,
    [onDisc, job.status, ring.slices, job.sectorsDone],
  );
  const showSectors = onDisc || job.status === 'done';

  const mediaBlocker = drives.media?.blocker ?? null;

  // The seam owns the running order's width; the hook owns the measurement and
  // every handler. `enabled` goes false while a row drag has the pointer, so
  // the gutter cannot steal a drag that started in the list.
  const { cols, sideWidth, effectiveMax, dragging, seamProps } = useBurnerSplit({
    splitRef,
    pageRef,
    enabled: !busy,
  });
  const expanded = isExpanded(stage);
  const canBurn =
    drives.supported &&
    !busy &&
    !blocker &&
    !mediaBlocker &&
    Boolean(drives.selectedId);

  return (
    <div
      ref={pageRef}
      className="content-body mainstage-inpage-split burner-page"
      data-stage={stage}
      data-expanded={expanded ? '1' : '0'}
      data-cols={cols}
      data-rehearsal={settings.testWrite || undefined}
      style={{ ['--burner-side-w' as string]: `${sideWidth}px` }}
    >
      <BurnChassis
        stage={stage}
        discTitle={discTitle}
        onDiscTitleChange={setDiscTitle}
        testWrite={settings.testWrite}
        jobTestWrite={job.testWrite}
        supported={drives.supported}
        recorders={drives.recorders}
        selectedId={drives.selectedId}
        onSelect={drives.select}
        media={drives.media}
        loading={drives.loading}
        onRefresh={drives.refresh}
        onErase={() => void handleErase()}
        onReload={() => void handleReload()}
        busy={busy}
        showReloadLabel={Boolean(mediaBlocker) && !busy}
      />

      {/* One line, always present, ranked by severity. Five banners used to
          appear and disappear here, and each one shortened the stage below —
          so putting a disc in the drive visibly shrank the disc on screen. */}
      <BurnAlertLine
        supported={drives.supported}
        drivesError={drives.error}
        mediaBlocker={mediaBlocker}
        needsDownloadCount={needsDownload.length}
        downloadBytes={downloadBytes}
        busy={busy}
        trackCount={layout.arcs.length}
        runtime={formatDuration(sectorsToSeconds(layout.totalSectors))}
        free={formatDuration(sectorsToSeconds(layout.remainingSectors))}
        hasDisc={Boolean(drives.media?.present)}
      />

      <div className="burner-split" ref={splitRef}>
        <section className="burner-rail">
          <BurnMetrics
            timing={timing}
            stage={stage}
            queueSeconds={sectorsToSeconds(layout.totalSectors)}
            remainingSectors={layout.remainingSectors}
            fits={layout.fits}
            overSectors={Math.max(0, layout.totalSectors - layout.capacitySectors)}
            fetchBytes={downloadBytes}
            tracksWritten={job.tracksWritten}
            finalElapsedSec={finalElapsed}
          />

          {/* Options sit under the metrics: that column is otherwise dead space
              beside a fixed-size disc, and every row it takes here is a row the
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
              disabled={busy}
            />
          </div>
        </section>

        <section className="burner-stage">
          {/* The well. It is what bounds the disc: `.burn-disc` sizes itself
              from `100cqmin` of this element, and it is the grid's `1fr` row,
              so the disc can only ever have the room the transport and the
              note below have not already claimed. Without this wrapper the
              disc had no size container at all, fell back to viewport units,
              laid out at its full ceiling and painted straight over the
              running order and the buttons. */}
          <div className="burner-stage-disc">
            <BurnDisc
              layout={layout}
              hoveredIndex={hoveredIndex}
              phase={job.phase}
              sectorsDone={job.sectorsDone}
              sectorsTotal={job.sectorsTotal || layout.totalSectors}
              trackIndex={job.trackIndex}
              trackTotal={tracks.length}
              busy={busy}
              testWrite={job.testWrite}
              finished={job.status === 'done'}
            />
          </div>

          {/* The mode belongs beside the button it changes, not in a column
              four hundred pixels away. While a job runs it is replaced in
              place, at the same height, so nothing below it moves. */}
          <div className="burner-mode">
            {stage === 'building' ? (
              <BurnModeSwitch
                testWrite={settings.testWrite}
                onChange={testWrite => setSettings(prev => ({ ...prev, testWrite }))}
                disabled={busy}
              />
            ) : (
              <span className="burner-mode-static">
                {job.testWrite ? t('burner.modeRehearse') : t('burner.modeBurn')}
              </span>
            )}
          </div>

          <div className="burner-transport">
            <button
              type="button"
              className="burner-btn"
              onClick={() => setListingOpen(true)}
              disabled={tracks.length === 0}
            >
              <ListMusic size={14} aria-hidden="true" />
              {t('burner.trackListing')}
            </button>

            {stage === 'committing' ? (
              /* Arm, then confirm. Not a modal: `ConfirmModal` binds Enter to
                 confirm unconditionally, which is the wrong default on a
                 dialog whose confirm button destroys a physical disc — and a
                 modal is the wrong thing to put between someone and stopping a
                 burn now. Arming works identically for mouse, keyboard and
                 switch users, which press-and-hold does not. */
              <button
                type="button"
                className="burner-btn is-danger"
                onClick={() => {
                  if (armed) void handleCancel();
                  else setArmedFor(job.phase);
                }}
                disabled={job.status === 'cancelling'}
                aria-describedby={COMMIT_WARNING_ID}
              >
                <Square size={14} aria-hidden="true" />
                {job.status === 'cancelling'
                  ? t('burner.cancelling')
                  : armed ? t('burner.abortConfirm') : t('burner.abort')}
              </button>
            ) : stage === 'preparing' ? (
              <button
                type="button"
                className="burner-btn"
                onClick={() => void handleCancel()}
                disabled={job.status === 'cancelling'}
              >
                <Square size={14} aria-hidden="true" />
                {job.status === 'cancelling' ? t('burner.cancelling') : t('burner.cancel')}
              </button>
            ) : (
              <button
                type="button"
                className="burner-btn is-primary"
                onClick={() => {
                  if (stage === 'settled') useBurnJobStore.getState().reset();
                  else void handleBurn();
                }}
                disabled={stage === 'settled' ? false : !canBurn}
              >
                <Flame size={14} aria-hidden="true" />
                {stage === 'settled'
                  ? t('burner.burnAnother')
                  : settings.testWrite ? t('burner.startTestWrite') : t('burner.startBurn')}
              </button>
            )}

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

          <div className="burner-stage-note">
            <BurnStageNote
              stage={stage}
              blocker={blocker ? t(blocker.key, blocker.values) : null}
              pastRedBook74={layout.pastRedBook74}
              job={job}
              finalElapsedSec={finalElapsed}
              queueSeconds={sectorsToSeconds(layout.totalSectors)}
              warningId={COMMIT_WARNING_ID}
            />
          </div>
        </section>

        <BurnSeam
          seamProps={seamProps}
          width={sideWidth}
          effectiveMax={effectiveMax}
          dragging={dragging}
        />

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

            {/* Deliberately not sticky: it sits above the scroller rather than
                inside it, so there is nothing for it to stick to. It lines up
                with the rows because it shares `--burn-row-cols` and the same
                inline padding — keep those two together or the labels drift
                off the columns they name. The three unlabelled cells hold the
                grip, the download mark and the remove control's tracks. */}
            {layout.arcs.length > 0 && (
              <div className="burner-rows-head" aria-hidden="true">
                <span />
                <span className="col-number">{t('burner.colNumber')}</span>
                <span className="col-track">{t('burner.colTrack')}</span>
                <span className="col-artist">{t('burner.colArtist')}</span>
                <span className="col-time">{t('burner.colTime')}</span>
                <span className="col-start">{t('burner.colStart')}</span>
                <span />
                <span />
              </div>
            )}

            <OverlayScrollArea
              className="burner-list-scroll"
              viewportId={BURNER_INPAGE_SCROLL_VIEWPORT_ID}
              viewportRef={listViewportRef}
            >
              <BurnTrackList
                arcs={layout.arcs}
                hoveredIndex={hoveredIndex}
                onHoverChange={setHoveredIndex}
                onRemove={removeTrack}
                onMove={moveTrack}
                onReorder={reorderTrack}
                activeIndex={activeRow}
                activePhase={busy ? job.phase : null}
                stage={stage}
                overrunFrom={overrunFrom}
                viewportRef={listViewportRef}
                writtenBefore={writtenRows}
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
