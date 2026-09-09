import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ListMusic, Printer, Save } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import Modal from '@/ui/Modal';
import { showToast } from '@/lib/dom/toast';
import type { DiscArc } from '@/features/burner/utils/capacity';
import {
  buildTrackListing,
  creditLine,
  formatListingAsText,
  listingFileName,
} from '@/features/burner/utils/trackListing';

export interface TrackListingModalProps {
  open: boolean;
  onClose: () => void;
  arcs: DiscArc[];
  discTitle: string;
}

/**
 * The running order, to keep or to print.
 *
 * Printing goes through the webview rather than through a file: the shell
 * permission is scoped to `https://**`, so the app cannot hand a local path to
 * the system opener, and asking for that permission to print a track listing
 * would be a poor trade. `window.print()` needs none of it.
 */
export default function TrackListingModal({
  open,
  onClose,
  arcs,
  discTitle,
}: TrackListingModalProps) {
  const { t } = useTranslation();

  const listing = useMemo(() => buildTrackListing(arcs, discTitle), [arcs, discTitle]);
  const text = useMemo(() => formatListingAsText(listing, new Date()), [listing]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('burner.listingCopied'), 2400, 'info');
    } catch {
      showToast(t('burner.listingCopyFailed'), 3200, 'error');
    }
  }, [text, t]);

  const handleSave = useCallback(async () => {
    const path = await save({
      title: t('burner.listingSaveTitle'),
      defaultPath: listingFileName(listing.discTitle),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (!path) return;
    try {
      await writeFile(path, new TextEncoder().encode(text));
      showToast(t('burner.listingSaved'), 2800, 'info');
    } catch (err) {
      console.error('[burner] listing save failed', err);
      showToast(err instanceof Error ? err.message : String(err), 4000, 'error');
    }
  }, [text, listing.discTitle, t]);

  const subtitle = t('burner.listingSummary', {
    count: listing.trackCount,
    duration: listing.totalDuration,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={listing.discTitle || t('burner.listingUntitled')}
      subtitle={subtitle}
      icon={<ListMusic size={16} aria-hidden="true" />}
      size="md"
      footer={
        <>
          <button type="button" className="burner-btn" onClick={() => void handleCopy()}>
            <Copy size={14} aria-hidden="true" /> {t('burner.listingCopy')}
          </button>
          <button type="button" className="burner-btn" onClick={() => void handleSave()}>
            <Save size={14} aria-hidden="true" /> {t('burner.listingSave')}
          </button>
          <button type="button" className="burner-btn is-primary" onClick={() => window.print()}>
            <Printer size={14} aria-hidden="true" /> {t('burner.listingPrint')}
          </button>
        </>
      }
    >
      {/* The one subtree the print stylesheet keeps. It is the preview and the
          printed sheet at once, so what is on screen is what comes out. */}
      <div className="burner-print-sheet">
        <header className="burner-print-head">
          <h2>{listing.discTitle || t('burner.listingUntitled')}</h2>
          <p>{subtitle}</p>
        </header>

        <ol className="burner-print-list">
          {listing.lines.map(line => (
            <li key={line.number}>
              <span className="burner-print-no">{String(line.number).padStart(2, '0')}</span>
              <span className="burner-print-credit">{creditLine(line.artist, line.title)}</span>
              <span className="burner-print-time">{line.duration}</span>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}
