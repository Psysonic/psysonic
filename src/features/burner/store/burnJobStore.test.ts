import { beforeEach, describe, expect, it } from 'vitest';
import { burnJobIsActive, burnJobIsCommitted, useBurnJobStore } from './burnJobStore';
import type { BurnProgressEvent } from '@/lib/api/burn';

function progress(overrides: Partial<BurnProgressEvent> = {}): BurnProgressEvent {
  return {
    jobId: 'job-1',
    phase: 'writing',
    trackIndex: 2,
    sectorsDone: 5000,
    sectorsTotal: 100_000,
    msf: '01:06:50',
    bufferPercent: 92,
    ...overrides,
  };
}

describe('burnJobStore', () => {
  beforeEach(() => {
    useBurnJobStore.getState().reset();
  });

  it('starts a job in the running state', () => {
    useBurnJobStore.getState().start('job-1', 100_000, false);
    const state = useBurnJobStore.getState();
    expect(state.jobId).toBe('job-1');
    expect(state.status).toBe('running');
    expect(state.sectorsTotal).toBe(100_000);
    expect(state.error).toBeNull();
  });

  it('applies progress for the running job', () => {
    useBurnJobStore.getState().start('job-1', 100_000, false);
    useBurnJobStore.getState().applyProgress(progress());
    const state = useBurnJobStore.getState();
    expect(state.sectorsDone).toBe(5000);
    expect(state.phase).toBe('writing');
    expect(state.bufferPercent).toBe(92);
  });

  it('ignores progress from a job the user already reset', () => {
    useBurnJobStore.getState().start('job-1', 100_000, false);
    useBurnJobStore.getState().reset();
    useBurnJobStore.getState().applyProgress(progress());
    expect(useBurnJobStore.getState().sectorsDone).toBe(0);
    expect(useBurnJobStore.getState().status).toBe('idle');
  });

  it('ignores progress from a different job id', () => {
    useBurnJobStore.getState().start('job-1', 100_000, false);
    useBurnJobStore.getState().applyProgress(progress({ jobId: 'job-2', sectorsDone: 999 }));
    expect(useBurnJobStore.getState().sectorsDone).toBe(0);
  });

  it('keeps the estimated total when an event reports none', () => {
    useBurnJobStore.getState().start('job-1', 100_000, false);
    useBurnJobStore.getState().applyProgress(progress({ sectorsTotal: 0 }));
    expect(useBurnJobStore.getState().sectorsTotal).toBe(100_000);
  });

  it('adopts the real total once Rust has rendered', () => {
    useBurnJobStore.getState().start('job-1', 100_000, false);
    useBurnJobStore.getState().applyProgress(progress({ sectorsTotal: 123_456 }));
    expect(useBurnJobStore.getState().sectorsTotal).toBe(123_456);
  });

  it('rolls a failed cancel request back to running', () => {
    useBurnJobStore.getState().start('job-1', 100_000, false);
    useBurnJobStore.getState().requestCancel();
    expect(useBurnJobStore.getState().status).toBe('cancelling');
    useBurnJobStore.getState().cancelRequestFailed();
    expect(useBurnJobStore.getState().status).toBe('running');
  });

  it('will not start cancelling a job that is not active', () => {
    useBurnJobStore.getState().requestCancel();
    expect(useBurnJobStore.getState().status).toBe('idle');
  });

  it('records a completed burn', () => {
    useBurnJobStore.getState().start('job-1', 100_000, false);
    useBurnJobStore.getState().finish({ tracksWritten: 12, sectorsWritten: 100_000 });
    const state = useBurnJobStore.getState();
    expect(state.status).toBe('done');
    expect(state.tracksWritten).toBe(12);
    expect(state.sectorsDone).toBe(100_000);
  });

  it('records a failure with its reason', () => {
    useBurnJobStore.getState().start('job-1', 100_000, false);
    useBurnJobStore.getState().fail('The disc was removed during the burn.');
    expect(useBurnJobStore.getState().status).toBe('failed');
    expect(useBurnJobStore.getState().error).toContain('removed');
  });

  it('clears a previous failure when a new job starts', () => {
    useBurnJobStore.getState().start('job-1', 100_000, false);
    useBurnJobStore.getState().fail('boom');
    useBurnJobStore.getState().start('job-2', 50_000, true);
    expect(useBurnJobStore.getState().error).toBeNull();
    expect(useBurnJobStore.getState().testWrite).toBe(true);
  });
});

describe('burnJobIsActive', () => {
  it('covers the in-flight states only', () => {
    expect(burnJobIsActive('running')).toBe(true);
    expect(burnJobIsActive('cancelling')).toBe(true);
    expect(burnJobIsActive('idle')).toBe(false);
    expect(burnJobIsActive('done')).toBe(false);
    expect(burnJobIsActive('failed')).toBe(false);
    expect(burnJobIsActive('cancelled')).toBe(false);
  });
});

describe('burnJobIsCommitted', () => {
  it('is true only once the laser is actually writing', () => {
    expect(burnJobIsCommitted('running', 'writing')).toBe(true);
    expect(burnJobIsCommitted('running', 'closing')).toBe(true);
  });

  it('is false while the job can still be stopped harmlessly', () => {
    expect(burnJobIsCommitted('running', 'rendering')).toBe(false);
    expect(burnJobIsCommitted('running', 'analyzing')).toBe(false);
    expect(burnJobIsCommitted('running', 'preparing')).toBe(false);
    expect(burnJobIsCommitted('idle', 'writing')).toBe(false);
  });
});
