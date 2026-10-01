let pendingAttempt: symbol | null = null;

export function beginColdResumeRequest(): () => void {
  const attempt = Symbol('cold-resume');
  pendingAttempt = attempt;
  return () => {
    if (pendingAttempt === attempt) pendingAttempt = null;
  };
}

/** A pause during an unfinished load must not turn the next Play into a warm resume. */
export function isColdResumePending(): boolean {
  return pendingAttempt !== null;
}

/** Load privately paused, then unpause only while this transport request still owns playback.
 * One fresh load is allowed on failure; never retry a seek against a stopped player.
 */
export async function coldResumePlayback(options: {
  loadPaused: () => Promise<unknown>;
  resume: () => Promise<void>;
  isCurrent: () => boolean;
}): Promise<void> {
  for (let retry = 0; retry < 2; retry++) {
    if (!options.isCurrent()) return;
    try {
      await options.loadPaused();
      if (!options.isCurrent()) return;
      await options.resume();
      return;
    } catch (error) {
      if (!options.isCurrent()) return;
      if (retry === 1) throw error;
    }
  }
}
