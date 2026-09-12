import { create } from 'zustand';
import type { LibraryEntitySourceDto } from '@/lib/api/library';
import { libraryResolveEntitySources } from '@/lib/api/library';
import type { QueueItemRef, Track } from '@/lib/media/trackTypes';
import { useAuthStore } from '@/store/authStore';
import { deriveEntitySourceScopes } from '@/lib/library/libraryBrowseScope';
import {
  queueItemIdentityKey,
  sameQueueItemRef,
} from '@/features/playback/utils/playback/queueIdentity';

export interface PlaybackSourceFailure {
  key: string;
  generation: number;
  queueIndex: number;
  expectedRef: QueueItemRef;
  track: Track;
  detail: string;
}

interface PlaybackAlternativeState {
  failure: PlaybackSourceFailure | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  sources: LibraryEntitySourceDto[];
  selectingKey: string | null;
  actionError: string | null;
  close: () => void;
}

let lastFailureKey: string | null = null;
let failureCycleQueue: string | null = null;
const unavailableQueueSlots = new Set<string>();

export const usePlaybackAlternativeStore = create<PlaybackAlternativeState>(set => ({
  failure: null,
  status: 'idle',
  sources: [],
  selectingKey: null,
  actionError: null,
  close: () => set({ failure: null, status: 'idle', sources: [], selectingKey: null, actionError: null }),
}));

function failureKey(generation: number, queueIndex: number, ref: QueueItemRef): string {
  return `${generation}:${queueIndex}:${ref.serverId}:${ref.trackId}`;
}

function queueFailureSignature(queueItems: QueueItemRef[]): string {
  return queueItems.map((item, index) => `${index}:${queueItemIdentityKey(item)}`).join('|');
}

export function recordUnavailablePlaybackFailure(
  queueItems: QueueItemRef[],
  queueIndex: number,
): boolean {
  const expectedRef = queueItems[queueIndex];
  if (!expectedRef || queueItems.length === 0) return false;

  const signature = queueFailureSignature(queueItems);
  if (failureCycleQueue !== signature) {
    failureCycleQueue = signature;
    unavailableQueueSlots.clear();
  }
  unavailableQueueSlots.add(`${queueIndex}:${queueItemIdentityKey(expectedRef)}`);
  return unavailableQueueSlots.size >= queueItems.length;
}

export function shouldAutoAdvanceAfterUnavailableFailure(args: {
  failedQueueItems: QueueItemRef[];
  failedQueueIndex: number;
  liveQueueItems: QueueItemRef[];
  liveQueueIndex: number;
}): boolean {
  const failedRef = args.failedQueueItems[args.failedQueueIndex];
  const liveRef = args.liveQueueItems[args.liveQueueIndex];
  if (
    args.liveQueueIndex !== args.failedQueueIndex
    || !failedRef
    || !liveRef
    || !sameQueueItemRef(liveRef, failedRef)
  ) return false;

  return !recordUnavailablePlaybackFailure(args.liveQueueItems, args.liveQueueIndex);
}

export function clearUnavailablePlaybackFailures(): void {
  failureCycleQueue = null;
  unavailableQueueSlots.clear();
}

export function reportPlaybackSourceFailure(args: {
  generation: number;
  queueIndex: number;
  queueItems: QueueItemRef[];
  track: Track | null;
  detail: string;
}, onUnavailable?: () => void): void {
  const expectedRef = args.queueItems[args.queueIndex];
  if (!expectedRef || !args.track) return;

  const key = failureKey(args.generation, args.queueIndex, expectedRef);
  if (lastFailureKey === key) return;
  lastFailureKey = key;

  const failure: PlaybackSourceFailure = {
    key,
    generation: args.generation,
    queueIndex: args.queueIndex,
    expectedRef: { ...expectedRef },
    track: { ...args.track },
    detail: args.detail,
  };
  usePlaybackAlternativeStore.setState({
    failure,
    status: 'loading',
    sources: [],
    selectingKey: null,
    actionError: null,
  });

  const auth = useAuthStore.getState();
  const scopes = deriveEntitySourceScopes(auth, expectedRef.serverId);

  void libraryResolveEntitySources(expectedRef.serverId, {
    entityType: 'track',
    anchorServerId: expectedRef.serverId,
    anchorId: expectedRef.trackId,
    scopes,
  }).then(sources => {
    if (usePlaybackAlternativeStore.getState().failure?.key !== key) return;
    const alternatives = sources
      .filter(source => !sameQueueItemRef(
        { serverId: source.serverId, trackId: source.id },
        expectedRef,
      ));
    usePlaybackAlternativeStore.setState({ status: 'ready', sources: alternatives });
    if (alternatives.length === 0) onUnavailable?.();
  }).catch(error => {
    console.error('[psysonic] alternative source lookup failed:', error);
    if (usePlaybackAlternativeStore.getState().failure?.key !== key) return;
    usePlaybackAlternativeStore.setState({ status: 'error', sources: [] });
    onUnavailable?.();
  });
}

export function setPlaybackAlternativeSelecting(source: LibraryEntitySourceDto | null): void {
  usePlaybackAlternativeStore.setState({
    selectingKey: source ? `${source.serverId}:${source.id}` : null,
    actionError: null,
  });
}

export function setPlaybackAlternativeActionError(): void {
  usePlaybackAlternativeStore.setState({ selectingKey: null, actionError: 'play_failed' });
}

export function dismissPlaybackSourceFailure(): void {
  usePlaybackAlternativeStore.getState().close();
}

export function _resetPlaybackAlternativeStoreForTest(): void {
  lastFailureKey = null;
  clearUnavailablePlaybackFailures();
  usePlaybackAlternativeStore.setState({
    failure: null,
    status: 'idle',
    sources: [],
    selectingKey: null,
    actionError: null,
  });
}
