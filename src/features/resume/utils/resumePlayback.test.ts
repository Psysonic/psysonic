import { describe, expect, it } from 'vitest';
import { makeTracks } from '@/test/helpers/factories';
import { resumeProgress } from './resumeProgress';
import { resumeStartIn } from './resumePlayback';

describe('resumeStartIn', () => {
  const tracks = makeTracks(4);

  it('uses the stored slot while the track is still there', () => {
    expect(resumeStartIn(tracks, { trackId: tracks[2]!.id, trackIndex: 2, positionSec: 40 }))
      .toEqual({ index: 2, positionSec: 40 });
  });

  it('follows the track when the list was reordered', () => {
    expect(resumeStartIn(tracks, { trackId: tracks[3]!.id, trackIndex: 1, positionSec: 40 }))
      .toEqual({ index: 3, positionSec: 40 });
  });

  it('starts the old slot from the beginning when the track left the list', () => {
    expect(resumeStartIn(tracks, { trackId: 'gone', trackIndex: 9, positionSec: 40 }))
      .toEqual({ index: 3, positionSec: 0 });
  });

  it('has nothing to start in an empty list', () => {
    expect(resumeStartIn([], { trackId: 'x', trackIndex: 0, positionSec: 1 })).toBeNull();
  });
});

describe('resumeProgress', () => {
  it('counts finished tracks plus the share of the current one', () => {
    expect(resumeProgress({ trackIndex: 1, trackCount: 4, positionSec: 50, durationSec: 100 })).toBeCloseTo(0.375);
  });

  it('stays within 0 and 1 for odd input', () => {
    expect(resumeProgress({ trackIndex: 5, trackCount: 4, positionSec: 500, durationSec: 100 })).toBe(1);
    expect(resumeProgress({ trackIndex: 0, trackCount: 0, positionSec: 0, durationSec: 0 })).toBe(0);
  });
});
