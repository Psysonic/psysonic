/**
 * Shared responsive card grids: capped columns, even stretch (`minmax(0, 1fr)`),
 * and row-height estimates derived from measured cell width (TanStack virtual rows).
 */

// Library grid column config. Owned here (pure layout math) and re-exported by
// authStoreDefaults, which clamps/defaults the user's libraryGridMaxColumns
// setting against them — keeps this module store-free so ui/ + cover/ can use it.
export const DEFAULT_LIBRARY_GRID_MAX_COLUMNS = 6;
export const LIBRARY_GRID_MAX_COLUMNS_MIN = 4;
export const LIBRARY_GRID_MAX_COLUMNS_MAX = 12;

export const CARD_GRID_GAP_PX = 16;
export const CARD_GRID_MIN_TILE_PX = 140;

/** @deprecated use `DEFAULT_LIBRARY_GRID_MAX_COLUMNS` */
export const CARD_GRID_MAX_COLS = DEFAULT_LIBRARY_GRID_MAX_COLUMNS;

export function computeCardGridColumnCount(containerWidthPx: number, maxColumns: number): number {
  const cap = Math.max(
    LIBRARY_GRID_MAX_COLUMNS_MIN,
    Math.min(LIBRARY_GRID_MAX_COLUMNS_MAX, Math.round(maxColumns)),
  );
  const raw = Math.floor(
    (containerWidthPx + CARD_GRID_GAP_PX) / (CARD_GRID_MIN_TILE_PX + CARD_GRID_GAP_PX),
  );
  return Math.min(cap, Math.max(1, raw));
}

export function computeCellWidthPx(containerWidthPx: number, columnCount: number): number {
  const c = Math.max(1, columnCount);
  return (containerWidthPx - (c - 1) * CARD_GRID_GAP_PX) / c;
}

export type CardGridRowHeightVariant =
  | 'artist'
  | 'album'
  | 'playlist'
  | 'offline'
  | 'composer'
  | 'albumTableRow';

/** Album table row height in CSS px — 40px cover thumb plus vertical padding. */
export const ALBUM_TABLE_ROW_HEIGHT_PX = 48;

/**
 * `max` is only for variants whose height does not follow the cell.
 *
 * An image tile's cover is square, so its height *is* the cell width plus a
 * fixed text block — measured against the real stylesheets, that block is
 * constant from 180px to 870px tiles (album 101, playlist 68, offline 114,
 * artist 52, the last one over an avatar inset 34px from the cell). Capping
 * such a row leaves it shorter than the card it has to hold, and because
 * `VirtualCardGrid` positions rows from this number without measuring them,
 * the next row lands on top of the previous one. Wide tiles are exactly what
 * the Settings column cap is for, so they must not be capped here.
 */
const VARIANT: Record<CardGridRowHeightVariant, { extra: number; min: number; max?: number }> = {
  artist: { extra: 72, min: 200 },
  /** Cover scales with cell width; ~108px headroom matches prior ~288px row at ~180px tiles. */
  album: { extra: 108, min: 260 },
  playlist: { extra: 108, min: 260 },
  /** Offline Library cards: album metadata + track-count footer + row gap in virtual rows. */
  offline: { extra: 140, min: 290 },
  /** Text-only composer tiles: no imagery → fixed intrinsic height, does not
   * scale with cell width like the image variants. min === max pins it. */
  composer: { extra: 0, min: 88, max: 88 },
  /** Full-width table rows: height is the row's own, independent of cell width
   * (the row spans the container). Pinned like `composer`. */
  albumTableRow: {
    extra: 0,
    min: ALBUM_TABLE_ROW_HEIGHT_PX,
    max: ALBUM_TABLE_ROW_HEIGHT_PX,
  },
};

export function estimateRowHeightPx(cellWidthPx: number, variant: CardGridRowHeightVariant): number {
  const { extra, min, max } = VARIANT[variant];
  const height = Math.ceil(cellWidthPx + extra);
  return max === undefined ? Math.max(min, height) : Math.max(min, Math.min(max, height));
}
