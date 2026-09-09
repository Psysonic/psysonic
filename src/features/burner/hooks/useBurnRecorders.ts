import { useCallback, useEffect, useState } from 'react';
import { burnIsSupported, listRecorders, probeMedia } from '@/lib/api/burn';
import type { BurnMediaInfo, BurnRecorder } from '@/lib/api/burn';

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
  const [supported, setSupported] = useState(true);
  const [recorders, setRecorders] = useState<BurnRecorder[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [media, setMedia] = useState<BurnMediaInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce(n => n + 1), []);

  // Drive list.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const isSupported = await burnIsSupported();
        if (cancelled) return;
        setSupported(isSupported);
        if (!isSupported) {
          setRecorders([]);
          return;
        }
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
  }, [nonce]);

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
    supported,
    recorders,
    selectedId,
    media,
    loading,
    error,
    select: setSelectedId,
    refresh,
  };
}
