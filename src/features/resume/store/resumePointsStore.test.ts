import { beforeEach, describe, expect, it } from 'vitest';
import {
  RESUME_POINTS_PER_SERVER,
  useResumePointsStore,
  type ResumePoint,
} from './resumePointsStore';

function point(id: string, serverKey: string, updatedAt: number): ResumePoint {
  return {
    kind: 'album', id, serverKey, name: id, trackId: `${id}-t`, trackIndex: 0, trackCount: 3,
    positionSec: 1, durationSec: 100, cover: {}, updatedAt,
  };
}

beforeEach(() => {
  useResumePointsStore.setState({ points: [], session: null });
});

describe('useResumePointsStore', () => {
  it('replaces the point of the same list and puts it first', () => {
    const { savePoint } = useResumePointsStore.getState();
    savePoint(point('a', 's1', 1));
    savePoint(point('b', 's1', 2));
    savePoint({ ...point('a', 's1', 3), positionSec: 42 });
    const points = useResumePointsStore.getState().points;
    expect(points.map(p => p.id)).toEqual(['a', 'b']);
    expect(points[0]?.positionSec).toBe(42);
  });

  it('keeps at most ten points per server and drops the oldest', () => {
    const { savePoint } = useResumePointsStore.getState();
    for (let i = 0; i < RESUME_POINTS_PER_SERVER + 2; i += 1) savePoint(point(`a${i}`, 's1', i));
    savePoint(point('other', 's2', 0));
    const points = useResumePointsStore.getState().points;
    expect(points.filter(p => p.serverKey === 's1')).toHaveLength(RESUME_POINTS_PER_SERVER);
    expect(points.some(p => p.id === 'a0' || p.id === 'a1')).toBe(false);
    expect(points.some(p => p.id === 'other')).toBe(true);
  });

  it('removes only the given list', () => {
    const { savePoint, removePoint } = useResumePointsStore.getState();
    savePoint(point('a', 's1', 1));
    savePoint(point('a', 's2', 2));
    removePoint({ kind: 'album', id: 'a', serverKey: 's1' });
    expect(useResumePointsStore.getState().points.map(p => p.serverKey)).toEqual(['s2']);
  });
});

describe('clearing and restoring points', () => {
  it('clears only the given servers and returns what it removed', () => {
    useResumePointsStore.setState({ points: [point('a', 's1', 1), point('b', 's2', 2), point('c', 's1', 3)] });
    const removed = useResumePointsStore.getState().clearServers(['s1']);
    expect(removed.map(p => p.id).sort()).toEqual(['a', 'c']);
    expect(useResumePointsStore.getState().points.map(p => p.id)).toEqual(['b']);
  });

  it('puts removed points back without replacing a newer point of the same list', () => {
    useResumePointsStore.setState({ points: [point('a', 's1', 1), point('b', 's1', 2)] });
    const removed = useResumePointsStore.getState().clearServers(['s1']);
    useResumePointsStore.getState().savePoint({ ...point('a', 's1', 5), positionSec: 77 });
    useResumePointsStore.getState().restorePoints(removed);
    const points = useResumePointsStore.getState().points;
    expect(points.map(p => p.id).sort()).toEqual(['a', 'b']);
    expect(points.find(p => p.id === 'a')?.positionSec).toBe(77);
  });

  it('keeps the per-server cap when restoring', () => {
    const old = point('old', 's1', 0);
    useResumePointsStore.setState({ points: [old] });
    useResumePointsStore.getState().removePoint(old);
    for (let i = 1; i <= RESUME_POINTS_PER_SERVER; i += 1) {
      useResumePointsStore.getState().savePoint(point(`n${i}`, 's1', i));
    }
    useResumePointsStore.getState().restorePoints([old]);
    const ids = useResumePointsStore.getState().points.map(p => p.id);
    expect(ids).toHaveLength(RESUME_POINTS_PER_SERVER);
    expect(ids).not.toContain('old');
  });
});
