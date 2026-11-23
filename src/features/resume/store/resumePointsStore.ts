import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ResumeKind = 'album' | 'playlist';

/** Everything the resume button and the Home card need, so neither loads anything. */
export interface ResumePoint {
  kind: ResumeKind;
  id: string;
  /** Profile id or index key the list was started with; playback and links use it as is. */
  serverId?: string;
  /** Canonical server key: the identity points are grouped and capped by. */
  serverKey: string;
  name: string;
  trackId: string;
  /** Position of the track in the list as it was queued, a fallback when the id moved. */
  trackIndex: number;
  trackCount: number;
  positionSec: number;
  durationSec: number;
  cover: {
    albumId?: string;
    coverArt?: string;
    discNumber?: number;
  };
  updatedAt: number;
}

/** The album or playlist the current queue was started from, while it plays. */
export interface ResumeSession {
  kind: ResumeKind;
  id: string;
  serverId?: string;
  serverKey: string;
  /** A track of this list played to its end, so leaving it leaves a point. */
  qualified: boolean;
  /** The last track played to its end: the list is done, nothing to resume. */
  finished: boolean;
}

export const RESUME_POINTS_PER_SERVER = 10;

export function resumePointKey(
  point: Pick<ResumePoint, 'kind' | 'id' | 'serverKey'>,
): string {
  return `${point.serverKey}\u0001${point.kind}\u0001${point.id}`;
}

/** Keeps the newest points of each server, at most `RESUME_POINTS_PER_SERVER`. */
function capPerServer(points: ResumePoint[]): ResumePoint[] {
  const perServer = new Map<string, number>();
  const kept = new Set<ResumePoint>();
  for (const point of [...points].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const count = perServer.get(point.serverKey) ?? 0;
    if (count >= RESUME_POINTS_PER_SERVER) continue;
    perServer.set(point.serverKey, count + 1);
    kept.add(point);
  }
  return points.filter(point => kept.has(point));
}

interface ResumePointsState {
  points: ResumePoint[];
  session: ResumeSession | null;
  savePoint: (point: ResumePoint) => void;
  removePoint: (point: Pick<ResumePoint, 'kind' | 'id' | 'serverKey'>) => void;
  /** Drops every point of these servers and returns them, for an undo. */
  clearServers: (serverKeys: readonly string[]) => ResumePoint[];
  /** Puts removed points back; a point written for the same list since then wins. */
  restorePoints: (points: readonly ResumePoint[]) => void;
  setSession: (session: ResumeSession | null) => void;
  updateSession: (patch: Partial<Pick<ResumeSession, 'qualified' | 'finished'>>) => void;
}

export const useResumePointsStore = create<ResumePointsState>()(
  persist(
    (set, get) => ({
      points: [],
      session: null,
      savePoint: point => set(state => {
        const key = resumePointKey(point);
        const others = state.points.filter(p => resumePointKey(p) !== key);
        const sameServer = others.filter(p => p.serverKey === point.serverKey);
        // Newest first; the oldest points of this server fall out past the cap.
        const dropped = new Set(
          sameServer
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(RESUME_POINTS_PER_SERVER - 1)
            .map(resumePointKey),
        );
        return { points: [point, ...others.filter(p => !dropped.has(resumePointKey(p)))] };
      }),
      removePoint: point => set(state => {
        const key = resumePointKey(point);
        if (!state.points.some(p => resumePointKey(p) === key)) return state;
        return { points: state.points.filter(p => resumePointKey(p) !== key) };
      }),
      clearServers: serverKeys => {
        const keys = new Set(serverKeys);
        const removed = get().points.filter(p => keys.has(p.serverKey));
        if (removed.length > 0) {
          set(state => ({ points: state.points.filter(p => !keys.has(p.serverKey)) }));
        }
        return removed;
      },
      restorePoints: restored => set(state => {
        const present = new Set(state.points.map(resumePointKey));
        const missing = restored.filter(p => !present.has(resumePointKey(p)));
        if (missing.length === 0) return state;
        return { points: capPerServer([...state.points, ...missing]) };
      }),
      setSession: session => set({ session }),
      updateSession: patch => set(state => (
        state.session ? { session: { ...state.session, ...patch } } : state
      )),
    }),
    {
      name: 'psysonic_resume_points',
      version: 1,
      partialize: state => ({ points: state.points, session: state.session }),
    },
  ),
);
