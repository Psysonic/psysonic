/**
 * CD Burner feature — renders library tracks to Red Book PCM and writes them
 * to a CD-R (Windows / IMAPI2 today).
 *
 * The `Burner` page is lazy-loaded by the router via its deep path, so it is
 * intentionally not re-exported here. Design notes, the CD-TEXT write and the
 * macOS plan live in `README.md` and `macimplementation.md` next to this file.
 */
export { useBurnListStore } from './store/burnListStore';
export {
  burnJobIsActive,
  burnJobIsCommitted,
  useBurnJobStore,
} from './store/burnJobStore';
export { primeBurnSupport, useBurnSupportStore } from './store/burnSupportStore';
export type { BurnSupport } from './store/burnSupportStore';
export { useBurnJobEvents } from './hooks/useBurnJobEvents';
export { MAX_TRACKS as BURN_MAX_TRACKS } from './utils/capacity';
export {
  addSongsToBurnList,
  addTracksToBurnList,
  burnTrackKey,
  songToBurnTrack,
} from './utils/addToBurnList';
export type { BurnableTrack } from './utils/addToBurnList';
export type { BurnQueueTrack } from './utils/capacity';
