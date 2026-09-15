import { describe, expect, it } from 'vitest';
import { classifyBurnFailure, discVerdict } from './burnOutcome';
import type { BurnJobState } from '@/features/burner/store/burnJobStore';

type Job = Pick<BurnJobState, 'status' | 'testWrite' | 'sectorsDone'>;

const job = (over: Partial<Job>): Job => ({
  status: 'done', testWrite: false, sectorsDone: 0, ...over,
});

describe('discVerdict', () => {
  it('says nothing while a job is still running', () => {
    expect(discVerdict(job({ status: 'idle' }))).toBeNull();
    expect(discVerdict(job({ status: 'running', sectorsDone: 5000 }))).toBeNull();
    expect(discVerdict(job({ status: 'cancelling', sectorsDone: 5000 }))).toBeNull();
  });

  it('a finished burn leaves a written disc', () => {
    expect(discVerdict(job({ status: 'done', sectorsDone: 200_000 }))).toBe('written');
  });

  it('a cancelled rehearsal leaves the disc blank, however far it got', () => {
    // The gate this function exists for. A rehearsal reports a growing sector
    // count exactly like a real burn — the laser is off, but the drive still
    // counts what it would have written. Without this the page tells someone
    // their untouched CD-R is ruined.
    expect(discVerdict(job({ status: 'cancelled', testWrite: true, sectorsDone: 180_000 })))
      .toBe('blank');
  });

  it('a failed rehearsal leaves the disc blank too', () => {
    expect(discVerdict(job({ status: 'failed', testWrite: true, sectorsDone: 90_000 })))
      .toBe('blank');
  });

  it('a finished rehearsal wrote nothing either', () => {
    expect(discVerdict(job({ status: 'done', testWrite: true, sectorsDone: 244_690 })))
      .toBe('blank');
  });

  it('a real burn stopped after the laser started spoils the disc', () => {
    expect(discVerdict(job({ status: 'cancelled', sectorsDone: 1 }))).toBe('spoiled');
    expect(discVerdict(job({ status: 'failed', sectorsDone: 120_000 }))).toBe('spoiled');
  });

  it('a real burn that failed before writing leaves the disc usable', () => {
    // Nothing reached the disc, so the CD-R is still good. Saying otherwise
    // would have people bin a blank.
    expect(discVerdict(job({ status: 'failed', sectorsDone: 0 }))).toBe('blank');
    expect(discVerdict(job({ status: 'cancelled', sectorsDone: 0 }))).toBe('blank');
  });
});

describe('classifyBurnFailure', () => {
  it('recognises a buffer underrun', () => {
    expect(classifyBurnFailure('the drive lost its data stream (buffer underrun)'))
      .toBe('burner.failHintBuffer');
  });

  it('recognises a media problem', () => {
    expect(classifyBurnFailure('This is non-CD media.')).toBe('burner.failHintMedia');
    expect(classifyBurnFailure('no disc in the drive')).toBe('burner.failHintMedia');
  });

  it('recognises the drive being held by something else', () => {
    expect(classifyBurnFailure('Access is denied. (0x5)')).toBe('burner.failHintPermission');
    expect(classifyBurnFailure('the device is busy')).toBe('burner.failHintPermission');
  });

  it('invents nothing for a message it does not know', () => {
    // The whole point. These come from a backend talking to real hardware, and
    // guessing a cause is worse than showing the drive's own words alone.
    expect(classifyBurnFailure('the drive reported status 0x02')).toBeNull();
    expect(classifyBurnFailure('SEND CUE SHEET failed: 5/24/00')).toBeNull();
    expect(classifyBurnFailure('')).toBeNull();
  });
});
