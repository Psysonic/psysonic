import { useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import {
  nextHistoryPosition,
  readHistoryIndex,
  type HistoryPosition,
} from '@/lib/navigation/historyPosition';

function readCurrentIndex(): number {
  return readHistoryIndex(typeof window === 'undefined' ? null : window.history.state);
}

/**
 * Tracks the current position in the app's history for the header's back /
 * forward buttons. Updated during render when the location changes, so the
 * buttons never show a stale state for a frame.
 */
export function useHistoryPosition(): HistoryPosition {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [tracked, setTracked] = useState(() => {
    const index = readCurrentIndex();
    return { key: location.key, position: { index, furthest: index } };
  });

  if (tracked.key !== location.key) {
    const position = nextHistoryPosition(tracked.position, navigationType, readCurrentIndex());
    setTracked({ key: location.key, position });
    return position;
  }
  return tracked.position;
}
