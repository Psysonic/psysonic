/**
 * Share feature — applying pasted entity/queue shares (server switch + resolve +
 * play/navigate) and enqueueing share-search results. The pure encode/decode/parse
 * and origin-label helpers live in `@/lib/share` (feature-free); these orchestrators
 * runtime-import offline/playback/orbit, so they are feature-scoped. Cross-feature
 * consumers use this barrel to preserve the dependency-cruiser boundary.
 */
export * from './applySharePaste';
export * from './enqueueShareSearchPayload';
export * from './playNavidromePublicShare';
export * from './components/ShareMethodMenu';
export { default as ShareTrackList } from './components/ShareTrackList';
export type { ShareTrackListItem } from './components/ShareTrackList';
export * from './hooks/useShareBootstrap';
export * from './outboundShare';
export * from './shareAvailability';
export * from './shareNavigation';
export * from './store/shareSettingsStore';
export * from './store/shareStore';
