import { describe, expect, it } from 'vitest';
import {
  ALBUM_TABLE_ROW_HEIGHT_PX,
  computeCardGridColumnCount,
  estimateRowHeightPx,
} from '@/lib/util/cardGridLayout';
import { LIBRARY_GRID_MAX_COLUMNS_MAX, LIBRARY_GRID_MAX_COLUMNS_MIN } from '@/store/authStoreDefaults';

describe('estimateRowHeightPx', () => {
  describe('composer variant', () => {
    // Composer tiles are text-only — they do not carry imagery that scales
    // with cell width. Reverting this to `cellWidthPx + extra` would re-open
    // the "200 px reserved per virtual row vs. ~78 px actual card" gap that
    // left empty space between every Composers grid row.
    it('returns a fixed height regardless of cell width', () => {
      expect(estimateRowHeightPx(40, 'composer')).toBe(88);
      expect(estimateRowHeightPx(150, 'composer')).toBe(88);
      expect(estimateRowHeightPx(400, 'composer')).toBe(88);
      expect(estimateRowHeightPx(2_000, 'composer')).toBe(88);
    });
  });

  describe('album table row variant', () => {
    // A table row spans the container, so its height is its own and must not
    // follow cell width. The smallest image variant clamps at 260 px and the
    // composer one at 88 px — both far above a 48 px row, which is why this
    // variant exists rather than reusing one of them.
    it('returns the pinned row height regardless of cell width', () => {
      expect(estimateRowHeightPx(40, 'albumTableRow')).toBe(ALBUM_TABLE_ROW_HEIGHT_PX);
      expect(estimateRowHeightPx(400, 'albumTableRow')).toBe(ALBUM_TABLE_ROW_HEIGHT_PX);
      expect(estimateRowHeightPx(2_000, 'albumTableRow')).toBe(ALBUM_TABLE_ROW_HEIGHT_PX);
    });
  });

  describe('image variants scale with cell width', () => {
    it('artist grows linearly with cell width above its floor', () => {
      expect(estimateRowHeightPx(200, 'artist')).toBe(272);
      expect(estimateRowHeightPx(50, 'artist')).toBe(200);   // min clamp
      expect(estimateRowHeightPx(1_000, 'artist')).toBe(1_072);
    });

    it('album grows linearly with cell width above its floor', () => {
      expect(estimateRowHeightPx(200, 'album')).toBe(308);
      expect(estimateRowHeightPx(50, 'album')).toBe(260);    // min clamp
      expect(estimateRowHeightPx(1_000, 'album')).toBe(1_108);
    });

    it('playlist behaves like album', () => {
      expect(estimateRowHeightPx(200, 'playlist')).toBe(308);
    });

    it('offline is taller than album for the track-count footer', () => {
      expect(estimateRowHeightPx(200, 'offline')).toBe(340);
      expect(estimateRowHeightPx(200, 'album')).toBe(308);
    });

    // The cards these rows carry were measured against the real stylesheets at
    // tile widths from 180px to 870px: an image tile is `cellWidth + <fixed
    // text block>` tall, and that block does not grow with the tile. `artist`
    // sits over an avatar inset 34px from the cell, hence its smaller figure.
    //
    // A row estimated shorter than its card is not cosmetic: `VirtualCardGrid`
    // places rows from this number and never measures them, so the next row is
    // drawn on top of the previous one. That is what a height cap here used to
    // do — on a 4K screen at six columns every album row overlapped the one
    // above it, while eight columns looked fine.
    const MEASURED_TEXT_BLOCK_PX = {
      album: 101,
      playlist: 68,
      offline: 114,
      artist: 52,
    } as const;

    it('never reserves less than the card needs, however wide the tile', () => {
      for (const [variant, textBlock] of Object.entries(MEASURED_TEXT_BLOCK_PX)) {
        for (const cellWidth of [200, 452, 600, 870, 1_200]) {
          expect(
            estimateRowHeightPx(cellWidth, variant as keyof typeof MEASURED_TEXT_BLOCK_PX),
            `${variant} at ${cellWidth}px`,
          ).toBeGreaterThanOrEqual(cellWidth + textBlock);
        }
      }
    });
  });
});

describe('computeCardGridColumnCount', () => {
  it('never exceeds the configured max', () => {
    expect(computeCardGridColumnCount(20_000, 6)).toBe(6);
    expect(computeCardGridColumnCount(20_000, 4)).toBe(4);
  });

  it('clamps requested max to store-wide upper bound', () => {
    expect(computeCardGridColumnCount(20_000, 99)).toBe(LIBRARY_GRID_MAX_COLUMNS_MAX);
  });

  it('clamps requested max to store-wide lower bound', () => {
    expect(computeCardGridColumnCount(20_000, 2)).toBe(LIBRARY_GRID_MAX_COLUMNS_MIN);
  });

  it('returns at least one column', () => {
    expect(computeCardGridColumnCount(50, 6)).toBe(1);
  });

  it('uses six columns on wide desktop when max allows', () => {
    expect(computeCardGridColumnCount(1200, 6)).toBe(6);
  });
});
