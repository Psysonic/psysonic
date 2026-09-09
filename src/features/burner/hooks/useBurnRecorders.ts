import { useCallback, useEffect, useState } from 'react';
import { listRecorders, probeMedia } from '@/lib/api/burn';
import type { BurnMediaInfo, BurnRecorder } from '@/lib/api/burn';
import { primeBurnSupport, useBurnSupportStore } from '@/features/burner/store/burnSupportStore';

export interface BurnRecordersState {
  supported: boolean;
  recorders: BurnRecorder[];
  selectedId: string;
  media: BurnMediaInfo | null;
  loading: boolean;
  error: string | null;
  select: (id: string) => void;
  refresh: () => void;
}

/**
 * Drive discovery and media probing.
 *
 * Re-probes whenever the selected drive changes and on every manual refresh —
 * discs get swapped while the page is open, and a stale capacity would let the
 * user queue a disc that cannot fit.
 */
export function useBurnRecorders(): BurnRecordersState {
  // Platform support is shared with the context menu and answered once per
  // process; this hook only waits for it.
  const support = useBurnSupportStore(s => s.supported);
  const [recorders, setRecorders] = useState<BurnRecorder[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [media, setMedia] = useState<BurnMediaInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    primeBurnSupport();
  }, []);

  // Drive list.
  useEffect(() => {
    // Still probing: showing "no drives" now would be a guess.
    if (support === 'unknown') return;
    if (support === 'no') {
      setRecorders([]);
      setSelectedId('');
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const found = await listRecorders();
        if (cancelled) return;
        setRecorders(found);
        setSelectedId(current => {
          const writable = found.filter(r => r.canWriteCd);
          if (current && writable.some(r => r.id === current)) return current;
          return writable[0]?.id ?? '';
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [support, nonce]);

  // Media in the selected drive.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!selectedId) {
        setMedia(null);
        return;
      }
      try {
        const info = await probeMedia({ recorderId: selectedId });
        if (!cancelled) setMedia(info);
      } catch {
        // A probe failure is nearly always an empty tray or a drive that just
        // went away; the refresh button is right there, so no toast.
        if (!cancelled) setMedia(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, nonce]);

  return {
    // "Not asked yet" must not render as unsupported — the page would flash a
    // notice and take it back.
    supported: support !== 'no',
    recorders,
    selectedId,
    media,
    loading,
    error,
    select: setSelectedId,
    refresh,
  };
}
