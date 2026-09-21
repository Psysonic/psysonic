type SeekRollback = {
  time: number;
  progress: number;
};

let generationCounter = 0;
let activeRequest: {
  generation: number;
  trackId: string;
  rollback: SeekRollback;
} | null = null;
let preservedPlaybackResetGeneration: number | null = null;
let fallbackTrackId: string | null = null;
let fallbackRestartAt = 0;

export function beginSeekRequest(
  trackId: string,
  rollbackTime: number,
  rollbackProgress: number,
): number {
  const generation = ++generationCounter;
  const rollback = activeRequest?.trackId === trackId
    ? activeRequest.rollback
    : { time: rollbackTime, progress: rollbackProgress };
  activeRequest = { generation, trackId, rollback };
  return generation;
}

export function isSeekRequestCurrent(generation: number, trackId: string): boolean {
  return activeRequest?.generation === generation && activeRequest.trackId === trackId;
}

export function completeSeekRequest(generation: number, trackId: string): void {
  if (isSeekRequestCurrent(generation, trackId)) activeRequest = null;
}

export function getSeekRequestRollback(
  generation: number,
  trackId: string,
): SeekRollback | null {
  return isSeekRequestCurrent(generation, trackId) ? activeRequest?.rollback ?? null : null;
}

export function preserveSeekRequestAcrossNextPlaybackReset(generation: number): () => void {
  preservedPlaybackResetGeneration = generation;
  return () => {
    if (preservedPlaybackResetGeneration === generation) {
      preservedPlaybackResetGeneration = null;
    }
  };
}

/** Returns true when the active request was invalidated, false when preserved. */
export function resetSeekRequestForPlaybackChange(): boolean {
  if (
    activeRequest
    && preservedPlaybackResetGeneration === activeRequest.generation
  ) {
    preservedPlaybackResetGeneration = null;
    return false;
  }
  generationCounter += 1;
  activeRequest = null;
  preservedPlaybackResetGeneration = null;
  fallbackTrackId = null;
  fallbackRestartAt = 0;
  return true;
}

export function getSeekFallbackTrackId(): string | null {
  return fallbackTrackId;
}

export function setSeekFallbackTrackId(trackId: string | null): void {
  fallbackTrackId = trackId;
}

export function getSeekFallbackRestartAt(): number {
  return fallbackRestartAt;
}

export function setSeekFallbackRestartAt(timestamp: number): void {
  fallbackRestartAt = timestamp;
}

export function _resetSeekRequestStateForTest(): void {
  generationCounter = 0;
  activeRequest = null;
  preservedPlaybackResetGeneration = null;
  fallbackTrackId = null;
  fallbackRestartAt = 0;
}
