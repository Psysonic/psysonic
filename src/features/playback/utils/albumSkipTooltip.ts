import type { TFunction } from 'i18next';
import { IS_MACOS } from '@/lib/util/platform';

/**
 * Tooltip for the previous/next buttons that also names the modifier-click
 * album jump — otherwise nobody would ever find it. macOS calls the key Option.
 */
export function albumSkipTooltip(t: TFunction, direction: 'next' | 'prev'): string {
  const key = IS_MACOS ? '⌥' : 'Alt';
  return direction === 'next'
    ? `${t('player.next')} · ${t('player.nextAlbumHint', { key })}`
    : `${t('player.prev')} · ${t('player.prevAlbumHint', { key })}`;
}
