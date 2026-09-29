import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Disc3, Download } from 'lucide-react';
import { formatBytes } from '@/features/burner/utils/capacity';

export type BurnAlertSeverity = 'error' | 'warn' | 'info' | 'idle';

export interface BurnAlertLineProps {
  /** False on a platform with no burn backend at all. */
  supported: boolean;
  /** Why drive enumeration failed, when it failed. */
  drivesError: string | null;
  /** Why the disc in the drive cannot be written to. */
  mediaBlocker: string | null;
  needsDownloadCount: number;
  downloadBytes: number;
  /** A job holds the drive, so drive-level messages are stale until it ends. */
  busy: boolean;
  trackCount: number;
  /** The queue's runtime, already formatted. */
  runtime: string;
  /** Headroom left on the disc, already formatted. */
  free: string;
  hasDisc: boolean;
}

interface AlertItem {
  id: string;
  severity: BurnAlertSeverity;
  text: string;
  icon: 'disc' | 'download';
}

/**
 * One line, always present, ranked hardest problem first.
 *
 * This replaces four independently appearing banners. Each of those shortened
 * the stage by its own height as it arrived, and the disc is sized from the
 * space the stage has left — so putting a disc in the drive visibly shrank the
 * showpiece. A single row of fixed height cannot do that: the messages change,
 * the geometry does not, and the overflow goes into a popover that is
 * positioned absolutely and therefore costs no layout at all.
 *
 * A job failure deliberately does not come here. It is an outcome, it belongs
 * beside the disc it ruined, and the stage note carries it.
 */
export default function BurnAlertLine({
  supported,
  drivesError,
  mediaBlocker,
  needsDownloadCount,
  downloadBytes,
  busy,
  trackCount,
  runtime,
  free,
  hasDisc,
}: BurnAlertLineProps) {
  const { t } = useTranslation();

  const items: AlertItem[] = [];
  if (!supported) {
    items.push({
      id: 'platform',
      severity: 'info',
      text: t('burner.platformUnsupported'),
      icon: 'disc',
    });
  }
  if (drivesError) {
    items.push({ id: 'drives', severity: 'error', text: drivesError, icon: 'disc' });
  }
  if (mediaBlocker && !busy) {
    items.push({ id: 'media', severity: 'warn', text: mediaBlocker, icon: 'disc' });
  }
  if (needsDownloadCount > 0 && !busy) {
    items.push({
      id: 'download',
      severity: 'info',
      text: t('burner.willDownload', {
        count: needsDownloadCount,
        size: formatBytes(downloadBytes),
      }),
      icon: 'download',
    });
  }
  // A machine that cannot burn at all has nothing true to say about what is in
  // its drive, so the resting line is left off there rather than guessing.
  if (supported) {
    items.push({
      id: 'status',
      severity: 'idle',
      text: hasDisc
        ? t('burner.alertReady', { count: trackCount, runtime, free })
        : t('burner.alertNoDisc'),
      icon: 'disc',
    });
  }

  const top = items[0] ?? null;
  const rest = items.slice(1);
  // The popover belongs to the set of messages it was opened over. Keying it to
  // their identity closes it the moment that set changes underneath the user,
  // which is what they would expect and what an effect would otherwise have to
  // chase after the fact.
  const signature = items.map(item => item.id).join('|');
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = rest.length > 0 && openFor === signature;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpenFor(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenFor(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!top) return <div className="burner-alert is-idle" />;

  // Only a real problem is worth interrupting a screen reader for. The resting
  // line changes every time a track is added, and announcing that would make
  // arranging a disc unbearable.
  const announce = top.severity === 'warn' || top.severity === 'error';

  return (
    <div
      ref={rootRef}
      className={`burner-alert is-${top.severity}`}
      aria-live={announce ? 'polite' : undefined}
      aria-atomic={announce ? true : undefined}
    >
      {top.icon === 'download'
        ? <Download size={14} aria-hidden="true" />
        : <Disc3 size={14} aria-hidden="true" />}
      <span className="burner-alert-text" title={top.text}>{top.text}</span>

      {rest.length > 0 && (
        <button
          type="button"
          className="burner-alert-more"
          aria-expanded={open}
          aria-label={t('burner.alertMore', { count: rest.length })}
          onClick={() => setOpenFor(open ? null : signature)}
        >
          {`+${rest.length}`}
        </button>
      )}

      {open && (
        <ul className="burner-alert-popover">
          {rest.map(item => (
            <li key={item.id} className={`burner-alert-popover-item is-${item.severity}`}>
              {item.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
