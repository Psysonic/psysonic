/**
 * Record-label browsing feature — the Labels overview (`Labels`) and the
 * per-label album browse (`LabelDetail`). Labels come from the local
 * `track_label` index, across every server and library in the browse scope.
 * The pages are lazy-loaded by the router via their deep paths, so they are
 * not re-exported here; nothing else outside the feature consumes its modules.
 */
export {};
