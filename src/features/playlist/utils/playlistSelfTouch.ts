export interface PlaylistReloadInputs {
  ownerChanged: boolean;
  offlineModeChanged: boolean;
  /** The playlist's `lastModified` stamp the load effect is running for. */
  lastModified: number | undefined;
  /** The stamp this page's own save wrote, if any. */
  selfTouchedAt: number | undefined;
}

/**
 * The detail page saves a reorder/removal itself and then touches the playlist
 * so other views refresh. That touch also re-runs the page's own load effect;
 * reloading there would unmount the whole list behind a spinner to show what is
 * already on screen. Skip exactly that case — any other trigger still reloads.
 */
export function isOwnPlaylistTouch(inputs: PlaylistReloadInputs): boolean {
  return !inputs.ownerChanged
    && !inputs.offlineModeChanged
    && inputs.lastModified !== undefined
    && inputs.lastModified === inputs.selfTouchedAt;
}
