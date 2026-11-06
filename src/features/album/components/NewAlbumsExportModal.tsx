import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, FolderOpen, X } from 'lucide-react';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { albumsAddedSince, loadNewestAlbums } from '@/features/album/utils/newAlbumsSince';
import { pageSizes, type NewAlbumsExportScheme } from '@/features/album/utils/newAlbumsExportLayout';
import { openNewAlbumsExportFolder, resolveNewAlbumsExportFolder } from '@/features/album/utils/newAlbumsExportFolder';

interface Props {
  onClose: () => void;
}

type Source = { status: 'loading' } | { status: 'ready'; albums: SubsonicAlbum[] } | { status: 'error' };

type Phase =
  | { kind: 'form' }
  | { kind: 'running'; page: number; pages: number }
  | { kind: 'done'; albums: number; images: number }
  | { kind: 'empty' }
  | { kind: 'failed'; error: string };

const SCHEMES: NewAlbumsExportScheme[] = ['dark', 'light'];
const LABEL_STYLE = { fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' } as const;
const FIELD_STYLE = { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1rem' } as const;

function localIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function NewAlbumsExportModal({ onClose }: Props) {
  const { t } = useTranslation();
  const ids = useId();
  const today = localIsoDate(new Date());
  const [date, setDate] = useState(today);
  const [scheme, setScheme] = useState<NewAlbumsExportScheme>('dark');
  const [source, setSource] = useState<Source>({ status: 'loading' });
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const running = phase.kind === 'running';

  // One read per dialog; changing the date only re-filters locally.
  useEffect(() => {
    let alive = true;
    loadNewestAlbums()
      .then(albums => { if (alive) setSource({ status: 'ready', albums }); })
      .catch(() => { if (alive) setSource({ status: 'error' }); });
    return () => { alive = false; };
  }, []);

  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    resolveNewAlbumsExportFolder()
      .then(f => { if (alive) setFolder(f); })
      .catch(() => { /* no path to show; the export resolves it again */ });
    return () => { alive = false; };
  }, []);

  const openFolder = () => {
    if (!folder) return;
    openNewAlbumsExportFolder(folder).catch(err => console.error('[album export] open folder failed:', err));
  };

  // A running export cannot be dismissed: it would keep writing files with no one told when it ends.
  const close = () => { if (!running) onClose(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, running]);

  const since = date ? new Date(`${date}T00:00:00`).getTime() : NaN;
  const matching = useMemo(
    () => (source.status === 'ready' && Number.isFinite(since) ? albumsAddedSince(source.albums, since) : null),
    [source, since],
  );

  let preview: string;
  if (source.status === 'loading') preview = t('albumExport.previewCounting');
  else if (source.status === 'error') preview = t('albumExport.previewError');
  else if (!matching) preview = '';
  else if (matching.length === 0) preview = t('albumExport.previewEmpty');
  else {
    const images = pageSizes(matching.length).length;
    preview = `${t('albumExport.albumCount', { count: matching.length })} · ${t('albumExport.previewImages', { count: images })}`;
  }
  const counting = source.status === 'loading';

  // Counting must finish first; after a failed count the export fetches the list itself.
  const canExport = Number.isFinite(since)
    && source.status !== 'loading'
    && !(matching && matching.length === 0)
    && !running;

  const runExport = async () => {
    setPhase({ kind: 'running', page: 0, pages: 0 });
    try {
      const { exportNewAlbumsImage } = await import('@/features/album/utils/exportNewAlbums');
      const albums = matching ?? albumsAddedSince(await loadNewestAlbums(), since);
      const result = await exportNewAlbumsImage({
        albums,
        since,
        scheme,
        onProgress: (page, pages) => setPhase({ kind: 'running', page, pages }),
      });
      setPhase(result ? { kind: 'done', albums: result.count, images: result.paths.length } : { kind: 'empty' });
    } catch (err) {
      console.error('[album export] export failed:', err);
      setPhase({ kind: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 120) });
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canExport) void runExport();
  };

  let status: { text: string; tone: 'muted' | 'success' | 'danger' };
  switch (phase.kind) {
    case 'running':
      status = {
        text: phase.pages > 0
          ? t('albumExport.progressPage', { page: phase.page, pages: phase.pages })
          : t('albumExport.progressPreparing'),
        tone: 'muted',
      };
      break;
    case 'done':
      status = {
        text: t('albumExport.resultSaved', {
          count: phase.images,
          albums: t('albumExport.albumCount', { count: phase.albums }),
        }),
        tone: 'success',
      };
      break;
    case 'empty':
      status = { text: t('albumExport.resultEmpty'), tone: 'danger' };
      break;
    case 'failed':
      status = { text: t('albumExport.resultFailed', { error: phase.error }), tone: 'danger' };
      break;
    default:
      status = { text: preview, tone: 'muted' };
  }
  const statusColor = status.tone === 'success' ? 'var(--positive)' : status.tone === 'danger' ? 'var(--danger)' : 'var(--text-secondary)';
  const done = phase.kind === 'done';

  return createPortal(
    <div
      className="modal-overlay"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${ids}-title`}
      aria-busy={running}
      style={{ alignItems: 'center', paddingTop: 0, zIndex: 100001 }}
    >
      <form className="modal-content" onClick={e => e.stopPropagation()} onSubmit={submit} style={{ maxWidth: '400px' }}>
        <button type="button" className="modal-close" onClick={close} disabled={running} aria-label={t('albumExport.close')}>
          <X size={18} />
        </button>
        <h3 id={`${ids}-title`} style={{ marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>
          {t('albumExport.dialogTitle')}
        </h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5, fontSize: '13px' }}>
          {t('albumExport.dialogHelp')}
        </p>

        <fieldset disabled={running || done} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <div style={FIELD_STYLE}>
            <label htmlFor={`${ids}-since`} style={LABEL_STYLE}>{t('albumExport.sinceLabel')}</label>
            <input
              id={`${ids}-since`}
              className="input"
              type="date"
              value={date}
              max={today}
              autoFocus
              onChange={e => { setDate(e.target.value); setPhase({ kind: 'form' }); }}
            />
          </div>

          <div style={FIELD_STYLE}>
            <span id={`${ids}-scheme`} style={LABEL_STYLE}>{t('albumExport.schemeLabel')}</span>
            <div className="settings-segmented" role="group" aria-labelledby={`${ids}-scheme`}>
              {SCHEMES.map(s => (
                <button
                  key={s}
                  type="button"
                  className={`btn ${scheme === s ? 'btn-primary' : 'btn-ghost'}`}
                  aria-pressed={scheme === s}
                  onClick={() => { setScheme(s); setPhase({ kind: 'form' }); }}
                >
                  {s === 'dark' ? t('albumExport.schemeDark') : t('albumExport.schemeLight')}
                </button>
              ))}
            </div>
          </div>
        </fieldset>

        {folder && (
          <div style={FIELD_STYLE}>
            <span style={LABEL_STYLE}>{t('albumExport.saveLocationLabel')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                title={folder}
                style={{ flex: 1, minWidth: 0, fontSize: '13px', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}
              >
                {folder}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={openFolder}
                style={{ padding: '0.4rem' }}
                aria-label={t('albumExport.openFolder')}
                data-tooltip={t('albumExport.openFolder')}
                data-tooltip-pos="bottom"
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </div>
        )}

        <p
          role="status"
          aria-live="polite"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: statusColor, marginBottom: '1.25rem', minHeight: '1.5em' }}
        >
          {(running || (counting && phase.kind === 'form')) && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} aria-hidden="true" />}
          {done && <CheckCircle2 size={14} aria-hidden="true" />}
          {status.text}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          {done ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setPhase({ kind: 'form' })}>
                {t('albumExport.exportAgain')}
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>
                {t('albumExport.close')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={close} disabled={running}>
                {t('albumExport.cancel')}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!canExport}
                aria-busy={counting || running}
                // `.btn` has no disabled look of its own; without this it reads as clickable.
                style={canExport ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}
              >
                {counting || running
                  ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, borderColor: 'currentColor', borderTopColor: 'transparent' }} aria-hidden="true" />
                  : <Download size={15} />}
                {t('albumExport.export')}
              </button>
            </>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
