import { useShallow } from 'zustand/react/shallow';
import { canonicalQueueServerKey } from '@/lib/server/serverIndexKey';
import { useAuthStore } from '@/store/authStore';
import {
  resumePointKey,
  useResumePointsStore,
  type ResumeKind,
  type ResumePoint,
} from '@/features/resume/store/resumePointsStore';

/**
 * The point for one album or playlist, or null. A list that is playing right
 * now has no point to show: its queue already is the resume.
 */
export function useResumePoint(
  kind: ResumeKind,
  id: string | undefined,
  serverId: string | undefined,
): ResumePoint | null {
  const activeServerId = useAuthStore(s => s.activeServerId ?? '');
  const serverKey = canonicalQueueServerKey(serverId || activeServerId);
  return useResumePointsStore(state => {
    if (!id) return null;
    const key = resumePointKey({ kind, id, serverKey });
    if (state.session && resumePointKey(state.session) === key) return null;
    return state.points.find(point => resumePointKey(point) === key) ?? null;
  });
}

/** Points of the given servers, newest first, without the list now playing. */
export function useResumePointsForServers(serverIds: readonly string[]): ResumePoint[] {
  const serverKeys = serverIds.map(id => canonicalQueueServerKey(id)).join('\u0001');
  return useResumePointsStore(useShallow(state => {
    const keys = new Set(serverKeys.split('\u0001'));
    const playing = state.session ? resumePointKey(state.session) : null;
    return state.points
      .filter(point => keys.has(point.serverKey) && resumePointKey(point) !== playing)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }));
}
