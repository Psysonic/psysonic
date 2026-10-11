import { describe, expect, it } from 'vitest';
import { toMini } from '@/features/miniPlayer/utils/miniTrackInfo';

describe('toMini', () => {
  it('hands the explicit status to the mini player window', () => {
    const mini = toMini({
      id: 't1', title: 'Song', artist: 'Artist', album: 'Album', albumId: 'a1',
      duration: 100, explicitStatus: 'explicit',
    });
    expect(mini.explicitStatus).toBe('explicit');
  });
});
