let canvasContext: CanvasRenderingContext2D | null | undefined;

/**
 * `scrollWidth` is rounded to whole pixels, so a header label measured at
 * exactly its width can still end in an ellipsis. A little room avoids that.
 */
const LABEL_ROUNDING_SLACK_PX = 2;

function textContext(): CanvasRenderingContext2D | null {
  if (canvasContext === undefined) {
    canvasContext = document.createElement('canvas').getContext('2d');
  }
  return canvasContext;
}

function horizontalPadding(el: Element): number {
  const style = getComputedStyle(el);
  return (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
}

/** Element whose font the cell's text is drawn in: the parent of the first non-empty text node. */
function textFontHost(cell: HTMLElement): Element {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() && node.parentElement) return node.parentElement;
  }
  return cell;
}

/**
 * Width a column needs to show all of its content, header label included —
 * smaller than the current width when the content is narrower.
 *
 * Rendered cells are laid out at their natural width for the moment of the
 * measurement (`data-tl-measuring`, see tracklist-model-a.css). Virtualised
 * tables only render the rows on screen, so for text columns every row's text
 * is measured as well: with the font of a rendered cell, plus the room that
 * cell needs besides its text (buttons, cover, padding).
 */
export function measureColumnContent(
  root: HTMLElement,
  key: string,
  texts: readonly string[] | null,
): number {
  const selector = `[data-tl-col="${CSS.escape(key)}"]`;
  let widest = 0;

  const headCell = root.querySelector<HTMLElement>(`.tl-head-cell${selector}`);
  if (headCell) {
    const label = headCell.querySelector<HTMLElement>('.tl-head-label');
    const arrow = headCell.querySelector<HTMLElement>('.tl-sort-indicator');
    const gap = parseFloat(getComputedStyle(headCell).columnGap) || 0;
    widest = horizontalPadding(headCell)
      + (label ? label.scrollWidth + LABEL_ROUNDING_SLACK_PX : 0)
      + (arrow ? arrow.getBoundingClientRect().width + gap : 0);
  }

  const cells = Array.from(root.querySelectorAll<HTMLElement>(`.tl-cell${selector}`));
  cells.forEach(cell => cell.setAttribute('data-tl-measuring', ''));
  try {
    cells.forEach(cell => { widest = Math.max(widest, cell.getBoundingClientRect().width); });

    if (texts && texts.length > 0) {
      const sample = cells.find(cell => cell.getAttribute('data-tl-text'));
      const ctx = textContext();
      if (sample && ctx) {
        ctx.font = getComputedStyle(textFontHost(sample)).font;
        const chrome = sample.getBoundingClientRect().width
          - ctx.measureText(sample.getAttribute('data-tl-text') ?? '').width;
        let widestText = 0;
        for (const text of texts) {
          if (text) widestText = Math.max(widestText, ctx.measureText(text).width);
        }
        widest = Math.max(widest, chrome + widestText);
      }
    }
  } finally {
    cells.forEach(cell => cell.removeAttribute('data-tl-measuring'));
  }

  return widest;
}

interface SongText {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
}

const SONG_TEXT_COLUMNS = new Set(['title', 'artist', 'album', 'genre']);

/** The text a song shows in a plain-text column, or `undefined` for other columns. */
export function songCellText(song: SongText, key: string): string | undefined {
  if (!SONG_TEXT_COLUMNS.has(key)) return undefined;
  return song[key as keyof SongText] ?? '';
}

/**
 * The text of a plain-text column for every song of a list, so an autofit can
 * measure rows a virtualised table has not rendered. Other columns return
 * `null` and are measured from the rendered cells only.
 */
export function songColumnTexts(songs: readonly SongText[], key: string): string[] | null {
  if (!SONG_TEXT_COLUMNS.has(key)) return null;
  return songs.map(song => songCellText(song, key) ?? '');
}
