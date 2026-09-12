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

  start: (jobId: string, sectorsTotal: number, testWrite: boolean) => void;
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
};

export const useBurnJobStore = create<BurnJobState>()((set) => ({
  ...IDLE,

  start: (jobId, sectorsTotal, testWrite) =>
    set({ ...IDLE, jobId, sectorsTotal, testWrite, status: 'running', phase: 'fetching' }),

  applyProgress: (event) =>
    set(state => {
      // Late events from a job the user already reset must not resurrect it.
      if (state.jobId !== event.jobId) return state;
      return {
        phase: event.phase,
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

  finish: ({ tracksWritten, sectorsWritten }) =>
    set({ status: 'done', phase: null, tracksWritten, sectorsDone: sectorsWritten, error: null }),

  fail: (error) => set({ status: 'failed', phase: null, error }),

  finishCancelled: () => set({ status: 'cancelled', phase: null, error: null }),

  reset: () => set({ ...IDLE }),
}));
