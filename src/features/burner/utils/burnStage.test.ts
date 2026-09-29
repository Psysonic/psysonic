import { describe, expect, it } from 'vitest';
import {
  burnStageFrom,
  colsFor,
  isExpanded,
  maxSideWidth,
  SIDE_MAX_PX,
} from '@/features/burner/utils/burnStage';
import type { BurnJobStatus, BurnPhase } from '@/features/burner/store/burnJobStore';

const PHASES: BurnPhase[] = ['fetching', 'analyzing', 'rendering', 'preparing', 'writing', 'closing'];

describe('burnStageFrom', () => {
  it('is building while the job has not started', () => {
    expect(burnStageFrom('idle', null)).toBe('building');
  });

  it('is preparing through every phase that writes nothing', () => {
    for (const phase of ['fetching', 'analyzing', 'rendering', 'preparing'] as BurnPhase[]) {
      expect(burnStageFrom('running', phase)).toBe('preparing');
    }
  });

  it('is committing once the laser is on', () => {
    expect(burnStageFrom('running', 'writing')).toBe('committing');
    expect(burnStageFrom('running', 'closing')).toBe('committing');
  });

  // A cancel request does not stop the drive; the disc is still being spoiled,
  // so the page must keep saying so.
  it('stays committing while a cancel is in flight mid-write', () => {
    expect(burnStageFrom('cancelling', 'writing')).toBe('committing');
    expect(burnStageFrom('cancelling', 'closing')).toBe('committing');
  });

  it('is preparing while a cancel is in flight before the laser', () => {
    expect(burnStageFrom('cancelling', 'fetching')).toBe('preparing');
    expect(burnStageFrom('cancelling', null)).toBe('preparing');
  });

  // The regression this whole stage split exists to prevent: a burn that dies
  // mid-write must not collapse the page at the moment the user needs to read
  // the error and look at the coaster they just made.
  it('settles on every terminal status, never back to building', () => {
    expect(burnStageFrom('done', null)).toBe('settled');
    expect(burnStageFrom('failed', null)).toBe('settled');
    expect(burnStageFrom('cancelled', null)).toBe('settled');
  });

  it('settles on a terminal status even if a late phase is still attached', () => {
    for (const status of ['done', 'failed', 'cancelled'] as BurnJobStatus[]) {
      for (const phase of PHASES) {
        expect(burnStageFrom(status, phase)).toBe('settled');
      }
    }
  });

  it('expands everything except building', () => {
    expect(isExpanded('building')).toBe(false);
    expect(isExpanded('preparing')).toBe(true);
    expect(isExpanded('committing')).toBe(true);
    expect(isExpanded('settled')).toBe(true);
  });
});

describe('colsFor', () => {
  it('breaks at the stated widths and not a pixel off', () => {
    expect(colsFor(939)).toBe(2);
    expect(colsFor(940)).toBe(3);
    expect(colsFor(639)).toBe(1);
    expect(colsFor(640)).toBe(2);
  });

  it('handles a split that has not been measured yet', () => {
    expect(colsFor(0)).toBe(1);
  });
});

describe('maxSideWidth', () => {
  it('leaves the stage its 300px at two columns', () => {
    expect(maxSideWidth(864, 2)).toBe(550);
    expect(maxSideWidth(660, 2)).toBe(346);
    expect(maxSideWidth(640, 2)).toBe(326);
  });

  it('charges the rail and its gutter at three columns', () => {
    expect(maxSideWidth(1340, 3)).toBe(SIDE_MAX_PX);
    expect(maxSideWidth(1000, 3)).toBe(454);
  });

  it('never returns less than the minimum, however cramped the split', () => {
    expect(maxSideWidth(400, 2)).toBe(320);
    expect(maxSideWidth(940, 3)).toBe(394);
  });

  it('imposes no bound at one column, where the seam is hidden', () => {
    expect(maxSideWidth(320, 1)).toBe(SIDE_MAX_PX);
  });
});
