/**
 * What happened to the disc, and why the burn failed.
 *
 * The app has always known both and never said either. A finished job simply
 * cleared its phase and the page fell back to reading REMAINING, which is the
 * one moment a person actually wants an answer: is this disc usable, or is it
 * a coaster?
 */
import type { BurnJobState } from '@/features/burner/store/burnJobStore';

/** The state of the physical disc once a job has stopped. */
export type DiscVerdict = 'spoiled' | 'blank' | 'written';

/**
 * What the drive left on the disc.
 *
 * The rehearsal gate is the important one. A cancelled rehearsal reports a
 * growing `sectorsDone` exactly like a real burn — the laser is off, but the
 * drive still counts what it would have written — so without that gate the
 * page tells someone their still-blank disc has been ruined.
 */
export function discVerdict(
  job: Pick<BurnJobState, 'status' | 'testWrite' | 'sectorsDone'>,
): DiscVerdict | null {
  if (job.status !== 'done' && job.status !== 'failed' && job.status !== 'cancelled') {
    return null;
  }
  if (job.status === 'done' && !job.testWrite) return 'written';
  if (job.testWrite) return 'blank';
  return job.sectorsDone > 0 ? 'spoiled' : 'blank';
}

/**
 * A hint at why a burn failed, or `null` when the message is not one we know.
 *
 * Returning `null` is the point. The message comes from a backend talking to a
 * real drive, and inventing a cause for one we do not recognise would be worse
 * than showing the drive's own words and nothing else.
 */
export function classifyBurnFailure(message: string): string | null {
  if (/buffer|underrun/i.test(message)) return 'burner.failHintBuffer';
  if (/medium|media|no disc/i.test(message)) return 'burner.failHintMedia';
  if (/permission|denied|busy|in use/i.test(message)) return 'burner.failHintPermission';
  return null;
}
