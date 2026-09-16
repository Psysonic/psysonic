import { create } from 'zustand';
import type { BurnProgressEvent } from '@/lib/api/burn';

export type BurnPhase = BurnProgressEvent['phase'];

export type BurnJobStatus =
  | 'idle'
  | 'running'
  | 'cancelling'
  | 'done'
  | 'failed'
  | 'cancelled';

export function burnJobIsActive(status: BurnJobStatus): boolean {
  return status === 'running' || status === 'cancelling';
}

/**
 * Once the laser is on, cancelling still spoils the disc — the UI warns
 * differently before and after this point.
 */
export function burnJobIsCommitted(status: BurnJobStatus, phase: BurnPhase | null): boolean {
  return burnJobIsActive(status) && (phase === 'writing' || phase === 'closing');
}

export interface BurnJobState {
  jobId: string | null;
  status: BurnJobStatus;
  phase: BurnPhase | null;
  /** 0-based, during the analyse and render phases. */
  trackIndex: number | null;
  sectorsDone: number;
  sectorsTotal: number;
  msf: string;
  bufferPercent: number | null;
  /** Set on failure; cleared whenever a new job starts. */
  error: string | null;
  testWrite: boolean;
  tracksWritten: number;
  /**
   * Whether this burn asked the drive for CD-TEXT. The completion event only
   * says whether it was written, so without this a disc that came back without
   * it — because the drive refused, or because the write never reached the
   * disc and was redone without it — looks the same as one that never asked.
   */
  cdTextRequested: boolean;
  /**
   * When the laser started, as epoch milliseconds, or `null` before it did.
   *
   * Kept here rather than in the page because the burner page can be left and
   * returned to while a burn runs: a timestamp in a component ref dies with it,
   * and the clock then restarts from the moment the user came back. That is how
   * a two-and-a-half minute rehearsal came to report four seconds.
   */
  writeStartedAt: number | null;
  /** How long the write took, fixed when the job ended. */
  elapsedSec: number | null;

  start: (jobId: string, sectorsTotal: number, testWrite: boolean, cdTextRequested?: boolean) => void;
  applyProgress: (event: BurnProgressEvent) => void;
  requestCancel: () => void;
  cancelRequestFailed: () => void;
  finish: (args: { tracksWritten: number; sectorsWritten: number }) => void;
  fail: (error: string) => void;
  finishCancelled: () => void;
  reset: () => void;
}

const IDLE = {
  jobId: null,
  status: 'idle' as BurnJobStatus,
  phase: null,
  trackIndex: null,
  sectorsDone: 0,
  sectorsTotal: 0,
  msf: '00:00:00',
  bufferPercent: null,
  error: null,
  testWrite: false,
  tracksWritten: 0,
  cdTextRequested: false,
  writeStartedAt: null,
  elapsedSec: null,
};

/** Seconds since `startedAt`, or `null` when the laser never started. */
function elapsedSince(startedAt: number | null): number | null {
  return startedAt === null ? null : Math.max(0, (Date.now() - startedAt) / 1000);
}

export const useBurnJobStore = create<BurnJobState>()((set) => ({
  ...IDLE,

  start: (jobId, sectorsTotal, testWrite, cdTextRequested = false) =>
    set({ ...IDLE, jobId, sectorsTotal, testWrite, cdTextRequested, status: 'running', phase: 'fetching' }),

  applyProgress: (event) =>
    set(state => {
      // Late events from a job the user already reset must not resurrect it.
      if (state.jobId !== event.jobId) return state;
      return {
        phase: event.phase,
        // The first event from a committed phase is the laser starting. Fetching
        // and rendering come first and write nothing, so timing them would
        // describe the wrong thing entirely.
        writeStartedAt:
          state.writeStartedAt ??
          (burnJobIsCommitted(state.status, event.phase) ? Date.now() : null),
        trackIndex: event.trackIndex,
        sectorsDone: event.sectorsDone,
        // Rust knows the real total once rendering is done; trust it over the estimate.
        sectorsTotal: event.sectorsTotal > 0 ? event.sectorsTotal : state.sectorsTotal,
        msf: event.msf,
        bufferPercent: event.bufferPercent,
      };
    }),

  requestCancel: () => set(state => (burnJobIsActive(state.status) ? { status: 'cancelling' } : state)),

  cancelRequestFailed: () =>
    set(state => (state.status === 'cancelling' ? { status: 'running' } : state)),

  // How long it took is fixed here, where the job ends, rather than read off a
  // clock the page owns: the page may not be mounted at this moment.
  finish: ({ tracksWritten, sectorsWritten }) =>
    set(state => ({
      status: 'done',
      phase: null,
      tracksWritten,
      sectorsDone: sectorsWritten,
      error: null,
      elapsedSec: elapsedSince(state.writeStartedAt),
    })),

  fail: (error) =>
    set(state => ({
      status: 'failed',
      phase: null,
      error,
      elapsedSec: elapsedSince(state.writeStartedAt),
    })),

  finishCancelled: () =>
    set(state => ({
      status: 'cancelled',
      phase: null,
      error: null,
      elapsedSec: elapsedSince(state.writeStartedAt),
    })),

  reset: () => set({ ...IDLE }),
}));
