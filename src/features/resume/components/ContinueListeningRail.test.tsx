import { Profiler } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { useResumePointsStore, type ResumePoint } from '@/features/resume/store/resumePointsStore';
import { resetAllStores } from '@/test/helpers/storeReset';
import { ContinueListeningRail } from './ContinueListeningRail';

function point(id: string, serverKey: string, updatedAt: number): ResumePoint {
  return {
    kind: 'album', id, serverKey, name: `Record ${id}`, trackId: `${id}-t`, trackIndex: 1, trackCount: 8,
    positionSec: 30, durationSec: 200, cover: {}, updatedAt,
  };
}

beforeEach(() => {
  resetAllStores();
  useResumePointsStore.setState({
    points: [point('a', 'srv', 1), point('b', 'srv', 3), point('c', 'other', 2)],
    session: null,
  });
});

describe('ContinueListeningRail', () => {
  it('shows the points of the given servers, newest first', () => {
    render(<ContinueListeningRail serverIds={['srv']} artworkSize={300} disableArtwork />);
    const titles = screen.getAllByText(/^Record /).map(node => node.textContent);
    expect(titles).toEqual(['Record b', 'Record a']);
  });

  it('renders nothing without points', () => {
    useResumePointsStore.setState({ points: [] });
    const { container } = render(<ContinueListeningRail serverIds={['srv']} artworkSize={300} disableArtwork />);
    expect(container.firstChild).toBeNull();
  });

  it('does not re-render while playback moves on', () => {
    let commits = 0;
    render(
      <Profiler id="rail" onRender={() => { commits += 1; }}>
        <ContinueListeningRail serverIds={['srv']} artworkSize={300} disableArtwork />
      </Profiler>,
    );
    const afterMount = commits;
    act(() => {
      for (let second = 1; second <= 20; second += 1) {
        usePlayerStore.setState({ currentTime: second, progress: second / 200, isPlaying: true });
      }
    });
    expect(commits).toBe(afterMount);
  });

  it('re-renders when a point is written', () => {
    let commits = 0;
    render(
      <Profiler id="rail" onRender={() => { commits += 1; }}>
        <ContinueListeningRail serverIds={['srv']} artworkSize={300} disableArtwork />
      </Profiler>,
    );
    const afterMount = commits;
    act(() => { useResumePointsStore.getState().savePoint(point('d', 'srv', 9)); });
    expect(commits).toBeGreaterThan(afterMount);
  });
});
