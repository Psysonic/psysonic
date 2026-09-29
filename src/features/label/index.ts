/**
 * Record-label browsing feature. The Labels overview lists every value of
 * Navidrome's `recordlabel` file tag; the per-label album page lives in the
 * album feature (`LabelAlbums`) and resolves labels through these helpers.
 * The page is lazy-loaded by the router via its deep path, so it is not
 * re-exported here.
 */
export { RECORD_LABEL_TAG, cleanLabelName } from './utils/labelDisplay';
