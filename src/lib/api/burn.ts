/**
 * Typed facade over the generated CD-burner commands.
 *
 * Result-wrapped commands re-throw on error so call sites keep plain
 * promise-reject semantics, matching `lib/api/syncfs.ts`.
 */
import { commands } from '@/generated/bindings';
import type {
  BurnMediaInfo,
  BurnOptions,
  BurnRecorder,
  BurnTrackInput,
} from '@/generated/bindings';

export type {
  BurnMediaInfo,
  BurnOptions,
  BurnRecorder,
  BurnTrackInput,
} from '@/generated/bindings';

/** Payload of the `burn:progress` event. */
export interface BurnProgressEvent {
  jobId: string;
  phase: 'fetching' | 'analyzing' | 'rendering' | 'preparing' | 'writing' | 'closing';
  trackIndex: number | null;
  sectorsDone: number;
  sectorsTotal: number;
  msf: string;
  bufferPercent: number | null;
}

/**
 * What reading CD-TEXT back off a disc found.
 *
 * Hand-written rather than generated, because it only ever arrives inside the
 * burn-complete EVENT payload, and specta types commands rather than events —
 * it stopped being emitted the moment the last command mentioning it went away.
 * Mirrors `CdTextVerification` in `crates/psysonic-burn/src/model.rs`; keep the
 * two in step.
 *
 * The three outcomes are deliberately distinct. An earlier version collapsed
 * "the drive refused the query" into "the disc has no CD-TEXT", which blamed
 * the drive for writing nothing when the truth may only have been that it would
 * not answer the question.
 */
export interface CdTextVerification {
  /** The read-back actually ran. When `false`, `packs` means nothing. */
  checked: boolean;
  /** Packs with a valid CRC found in the lead-in. */
  packs: number;
  /** Why the check could not run, when it could not. */
  error: string | null;
}

/** Payload of the `burn:complete` event. */
export interface BurnCompleteEvent {
  jobId: string;
  cancelled: boolean;
  tracksWritten: number;
  sectorsWritten: number;
  error: string | null;
  testWrite: boolean;
  /** CD-TEXT was requested and the drive accepted the write. */
  cdTextWritten: boolean;
  /** What reading the finished disc back found. `null` = not checked. */
  cdTextVerification: CdTextVerification | null;
}

/** Whether this platform has a burn backend at all (Windows, macOS, Linux). */
export function burnIsSupported(): Promise<boolean> {
  return commands.burnIsSupported();
}

export async function listRecorders(): Promise<BurnRecorder[]> {
  const res = await commands.burnListRecorders();
  if (res.status === 'error') throw new Error(res.error);
  return res.data;
}

export async function probeMedia(args: { recorderId: string }): Promise<BurnMediaInfo> {
  const res = await commands.burnProbeMedia(args.recorderId);
  if (res.status === 'error') throw new Error(res.error);
  return res.data;
}

export async function startBurn(args: {
  jobId: string;
  tracks: BurnTrackInput[];
  options: BurnOptions;
}): Promise<void> {
  const res = await commands.burnStart(args.jobId, args.tracks, args.options);
  if (res.status === 'error') throw new Error(res.error);
}

/** Resolves false when the job had already finished. */
export function cancelBurn(args: { jobId: string }): Promise<boolean> {
  return commands.burnCancel(args.jobId);
}

/**
 * A cheap fingerprint of what is in the drive.
 *
 * Opaque by design: compare it with the last one seen and re-probe when it
 * differs. Each platform answers with whatever it can ask most cheaply, and
 * none of that leaks up here.
 */
export async function mediaState(args: { recorderId: string }): Promise<string> {
  const res = await commands.burnMediaState(args.recorderId);
  if (res.status === 'error') throw new Error(res.error);
  return res.data;
}

/**
 * Eject the disc and pull it back in.
 *
 * The way out of a stale drive verdict: a rehearsal leaves the drive holding a
 * session it opened and never closed, so it goes on describing an untouched
 * CD-R as used — and a CD-R cannot be erased back out of that.
 *
 * Not a quirk of any one platform, whatever it first looked like: Linux asks
 * the drive directly and gets the same wrong-looking answer as Windows does
 * through IMAPI2. A burn now reloads after a rehearsal on its own, so this is
 * the manual escape hatch rather than the usual route.
 */
export async function reloadMedia(args: { recorderId: string }): Promise<void> {
  const res = await commands.burnReloadMedia(args.recorderId);
  if (res.status === 'error') throw new Error(res.error);
}

export async function eraseDisc(args: { recorderId: string; quick: boolean }): Promise<void> {
  const res = await commands.burnErase(args.recorderId, args.quick);
  if (res.status === 'error') throw new Error(res.error);
}
