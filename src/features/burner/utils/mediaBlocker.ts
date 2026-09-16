import type { BurnMediaBlocker } from '@/lib/api/burn';

/** A message to show, as a key the caller translates. */
export interface MediaBlockerText {
  key: string;
  values?: Record<string, string>;
}

/**
 * The i18n key for each problem the backend can report about the disc.
 *
 * The backend sends a code rather than a sentence for exactly this: every other
 * message it produces is finished English prose that the page renders verbatim,
 * and no locale file can reach those. This one is the message a user meets in
 * normal use — it sits in the alert line whenever the disc is wrong — so it is
 * said in their language instead.
 *
 * Typed as a total map, so a blocker added on the Rust side cannot be built
 * here until it has a key.
 */
const KEYS: Record<BurnMediaBlocker, string> = {
  noDisc: 'burner.mediaBlockerNoDisc',
  notCd: 'burner.mediaBlockerNotCd',
  alreadyWritten: 'burner.mediaBlockerAlreadyWritten',
  notBlankRewritable: 'burner.mediaBlockerNotBlankRewritable',
  notBlankRecordable: 'burner.mediaBlockerNotBlankRecordable',
  driveRefusedDisc: 'burner.mediaBlockerDriveRefused',
  driveSilent: 'burner.mediaBlockerDriveSilent',
};

/**
 * Describe the disc in the drive, or nothing when it can be burned.
 *
 * `mediaType` is the drive's own name for what it found ("CD-ROM", "DVD-R"),
 * and only one message uses it.
 */
export function describeMediaBlocker(
  blocker: BurnMediaBlocker | null | undefined,
  mediaType: string,
): MediaBlockerText | null {
  if (!blocker) return null;
  const key = KEYS[blocker];
  // A drive reporting something this build has no key for must still say the
  // disc is unusable rather than falling silent and leaving Burn enabled.
  if (!key) return { key: 'burner.mediaBlockerUnknown' };
  return blocker === 'notCd' ? { key, values: { mediaType } } : { key };
}
