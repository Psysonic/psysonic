import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureColumnContent, songCellText, songColumnTexts } from '@/ui/tracklist/measureColumnContent';

function el(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

function setScrollWidth(node: Element | null, px: number) {
  Object.defineProperty(node, 'scrollWidth', { configurable: true, value: px });
}

/**
 * A cell that is `current` px wide in the table but needs only `natural` px:
 * like a browser, it reports its natural width only while it is laid out for
 * measuring (`data-tl-measuring`).
 */
function sizeCell(cell: Element, current: number, natural: number) {
  (cell as HTMLElement).getBoundingClientRect = () => {
    const width = cell.hasAttribute('data-tl-measuring') ? natural : current;
    return { width, left: 0, right: width, top: 0, bottom: 20, height: 20, x: 0, y: 0, toJSON: () => ({}) };
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('measureColumnContent', () => {
  it('fits the widest cell, even when that makes the column narrower', () => {
    const root = el(`
      <div class="tl-head-cell" data-tl-col="album"><span class="tl-head-label">Album</span></div>
      <div class="tl-cell" data-tl-col="album"><span>A</span></div>
      <div class="tl-cell" data-tl-col="album"><span>B</span></div>`);
    setScrollWidth(root.querySelector('.tl-head-label'), 60);
    const cells = root.querySelectorAll('.tl-cell');
    sizeCell(cells[0], 400, 150);
    sizeCell(cells[1], 400, 90);
    expect(measureColumnContent(root, 'album', null)).toBe(150);
  });

  it('leaves the cells as they were after measuring', () => {
    const root = el(`<div class="tl-cell" data-tl-col="album"><span>A</span></div>`);
    sizeCell(root.querySelector('.tl-cell')!, 400, 150);
    measureColumnContent(root, 'album', null);
    expect(root.querySelector('[data-tl-measuring]')).toBeNull();
  });

  it('counts the header label, its padding and the sort arrow', () => {
    const root = el(`
      <div class="tl-head-cell" data-tl-col="bpm" style="padding-left: 10px; padding-right: 10px; column-gap: 4px">
        <span class="tl-head-label">BPM</span><span class="tl-sort-indicator">▲</span>
      </div>
      <div class="tl-cell" data-tl-col="bpm"><span>9</span></div>`);
    setScrollWidth(root.querySelector('.tl-head-label'), 200);
    (root.querySelector('.tl-sort-indicator') as HTMLElement).getBoundingClientRect = () =>
      ({ width: 8, left: 0, right: 8, top: 0, bottom: 10, height: 10, x: 0, y: 0, toJSON: () => ({}) });
    sizeCell(root.querySelector('.tl-cell')!, 70, 30);
    // 10 + 200 + 4 + 8 + 10, plus the rounding slack
    expect(measureColumnContent(root, 'bpm', null)).toBe(234);
  });

  it('measures every row from the data, not only the rendered ones', () => {
    const root = el(`
      <div class="tl-head-cell" data-tl-col="title"><span class="tl-head-label">Title</span></div>
      <div class="tl-cell" data-tl-col="title" data-tl-text="Short"><button></button><span>Short</span></div>`);
    setScrollWidth(root.querySelector('.tl-head-label'), 40);
    // Natural width 100 for "Short" (5 chars × 10 = 50) → 50 px of buttons and padding.
    sizeCell(root.querySelector('.tl-cell')!, 340, 100);
    const measureText = vi.fn((s: string) => ({ width: s.length * 10 }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText } as never);
    // chrome 50 + widest text 30 × 10 = 350
    expect(measureColumnContent(root, 'title', ['Short', 'a'.repeat(30), 'mid length'])).toBe(350);
  });
});

// scrollWidth is rounded to whole pixels, so a label measured at exactly its
// width can still end in an ellipsis ("DURATI…" after "Fit all columns").
it('leaves the header label a little room so it is never cut off', () => {
  const root = el(`
    <div class="tl-head-cell" data-tl-col="duration" style="padding-left: 10px; padding-right: 10px"><span class="tl-head-label">Duration</span></div>`);
  setScrollWidth(root.querySelector('.tl-head-label'), 62);
  expect(measureColumnContent(root, 'duration', null)).toBeGreaterThanOrEqual(84);
});

describe('songCellText', () => {
  const song = { title: 'One', artist: 'A', album: 'Rec', genre: 'Pop' };

  it('gives the text of a text column', () => {
    expect(songCellText(song, 'title')).toBe('One');
    expect(songCellText(song, 'artist')).toBe('A');
    expect(songCellText(song, 'album')).toBe('Rec');
    expect(songCellText(song, 'genre')).toBe('Pop');
  });

  it('has no text for other columns', () => {
    expect(songCellText(song, 'rating')).toBeUndefined();
  });
});

describe('songColumnTexts', () => {
  const songs = [
    { title: 'One', artist: 'A', album: 'Rec', genre: 'Pop' },
    { title: 'Two', artist: 'B', album: 'Rec' },
  ];

  it('lists the text of a text column for every song', () => {
    expect(songColumnTexts(songs, 'title')).toEqual(['One', 'Two']);
    expect(songColumnTexts(songs, 'genre')).toEqual(['Pop', '']);
  });

  it('has no texts for columns that are not plain text', () => {
    expect(songColumnTexts(songs, 'rating')).toBeNull();
  });
});
