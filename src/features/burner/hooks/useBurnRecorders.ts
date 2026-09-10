import { useCallback, useEffect, useState } from 'react';
import { listRecorders, mediaState, probeMedia } from '@/lib/api/burn';
import type { BurnMediaInfo, BurnRecorder } from '@/lib/api/burn';
import { primeBurnSupport, useBurnSupportStore } from '@/features/burner/store/burnSupportStore';

/** How often to ask the drive what is in it, while the page is open. */
const MEDIA_POLL_MS = 3000;

export interface BurnRecordersState {
  supported: boolean;
  recorders: BurnRecorder[];
  selectedId: string;
  media: BurnMediaInfo | null;
  loading: boolean;
  /**
   * Why the drive list is empty, when it is empty because enumeration failed
   * rather than because the machine has no burner.
   *
   * The page has to render this. An empty picker on its own reads as "there is
   * no drive here", which is the wrong thing to tell someone whose drive was
   * merely busy or whose backend errored — and it leaves them with nothing to
   * act on but the refresh button they have no reason to press.
   */
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
export function useBurnRecorders(paused = false): BurnRecordersState {
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
      // React Compiler set-state-in-effect rule: local state cleared to match
      // an external fact (this build has no burn backend), not derived from
      // props, so there is nothing to compute during render instead.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Watch for a disc being put in or taken out.
  //
  // Polling a cheap fingerprint rather than re-probing: a full probe reads ATIP
  // and the TOC and can make the drive seek, which is not something to do every
  // few seconds. Paused while a burn runs — the drive is held exclusively then,
  // and the job's own events already drive the UI — and while the window is
  // hidden, so a backgrounded app is not keeping an optical drive awake.
  useEffect(() => {
    if (!selectedId || paused) return;
    let cancelled = false;
    let last: string | null = null;

    const tick = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const token = await mediaState({ recorderId: selectedId });
        if (cancelled) return;
        // The first token establishes the baseline; only a change re-probes.
        if (last !== null && token !== last) setNonce(n => n + 1);
        last = token;
      } catch {
        // A drive that will not answer is not an error worth surfacing from a
        // background poll; the next tick tries again.
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), MEDIA_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedId, paused]);

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
