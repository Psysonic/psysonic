import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useResumePointsStore, type ResumePoint } from '@/features/resume/store/resumePointsStore';
import { ResumeButton } from './ResumeButton';

const point: ResumePoint = {
  kind: 'album', id: 'al-1', serverId: 'srv', serverKey: 'srv', name: 'A record', trackId: 't4',
  trackIndex: 3, trackCount: 9, positionSec: 133, durationSec: 240, cover: {}, updatedAt: 1,
};

beforeEach(() => {
  useResumePointsStore.setState({ points: [point], session: null });
});

describe('ResumeButton', () => {
  it('shows the track and time playback stopped at', () => {
    render(<ResumeButton kind="album" id="al-1" serverId="srv" />);
    expect(screen.getByRole('button').textContent).toContain('4');
    expect(screen.getByRole('button').textContent).toContain('2:13');
  });

  it('renders nothing for a list without a point', () => {
    const { container } = render(<ResumeButton kind="album" id="al-2" serverId="srv" />);
    expect(container.firstChild).toBeNull();
  });

  it('hides while that list is the one playing', () => {
    useResumePointsStore.setState({
      session: { kind: 'album', id: 'al-1', serverId: 'srv', serverKey: 'srv', qualified: true, finished: false },
    });
    const { container } = render(<ResumeButton kind="album" id="al-1" serverId="srv" />);
    expect(container.firstChild).toBeNull();
  });
});
