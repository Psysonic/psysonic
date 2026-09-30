import { describe, expect, it, vi } from 'vitest';
import { beginColdResumeRequest, coldResumePlayback, isColdResumePending } from './coldResumePlayback';

vi.mock('@/lib/api/debugLog', () => ({ frontendDebugLog: vi.fn() }));

describe('cold resume recovery', () => {
  it('unpauses only after the positioned paused load completes', async () => {
    let finish!: () => void;
    const loadPaused = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const resume = vi.fn(async () => {});
    const pending = coldResumePlayback({ loadPaused, resume, isCurrent: () => true });
    expect(resume).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(loadPaused).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('uses a fresh load once after a failure', async () => {
    const loadPaused = vi.fn().mockRejectedValueOnce(new Error('seek timeout')).mockResolvedValue(undefined);
    const resume = vi.fn(async () => {});
    await coldResumePlayback({ loadPaused, resume, isCurrent: () => true });
    expect(loadPaused).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('fails closed after two failures without starting from zero', async () => {
    const loadPaused = vi.fn(async () => { throw new Error('seek timeout'); });
    const resume = vi.fn(async () => {});
    await expect(coldResumePlayback({ loadPaused, resume, isCurrent: () => true })).rejects.toThrow('seek timeout');
    expect(loadPaused).toHaveBeenCalledTimes(2);
    expect(resume).not.toHaveBeenCalled();
  });

  it('reloads rather than reusing a player when resume reports no sink', async () => {
    const loadPaused = vi.fn(async () => {});
    const resume = vi.fn().mockRejectedValueOnce(new Error('audio sink not ready')).mockResolvedValue(undefined);
    await coldResumePlayback({ loadPaused, resume, isCurrent: () => true });
    expect(loadPaused).toHaveBeenCalledTimes(2);
  });

  it.each(['pause', 'stop', 'track change', 'new resume'])('does not unpause an obsolete load after %s', async () => {
    let current = true;
    let finish!: () => void;
    const loadPaused = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const resume = vi.fn(async () => {});
    const pending = coldResumePlayback({ loadPaused, resume, isCurrent: () => current });
    current = false;
    finish();
    await pending;
    expect(resume).not.toHaveBeenCalled();
    expect(loadPaused).toHaveBeenCalledTimes(1);
  });

  it('does not retry an obsolete failure', async () => {
    let current = true;
    const loadPaused = vi.fn(async () => { current = false; throw new Error('seek timeout'); });
    const resume = vi.fn(async () => {});
    await coldResumePlayback({ loadPaused, resume, isCurrent: () => current });
    expect(loadPaused).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
  });

  it('keeps a newer pending request when an older request finishes', () => {
    const finishOld = beginColdResumeRequest();
    const finishNew = beginColdResumeRequest();
    finishOld();
    expect(isColdResumePending()).toBe(true);
    finishNew();
    expect(isColdResumePending()).toBe(false);
  });
});
