/**
 * Draws one page of the new-albums export: header with heading, wordmark,
 * date line and part number; a two-column grid read left to right; footer with
 * the site and the album range. All text arrives pre-localized from the caller.
 */
import {
  NEW_ALBUMS_EXPORT_COLUMN_WIDTH as COL_W,
  NEW_ALBUMS_EXPORT_GEOMETRY as G,
  NEW_ALBUMS_EXPORT_TEXT_WIDTH as TEXT_W,
  NEW_ALBUMS_EXPORT_TYPE as T,
  albumMetaLine,
  exportFont,
  wrapText,
  type NewAlbumsExportPalette,
} from './newAlbumsExportLayout';

export interface NewAlbumsExportEntry {
  artist: string;
  title: string;
  year?: number;
  genre?: string;
}

export interface NewAlbumsExportPageStrings {
  heading: string;
  /** "Since 3 November 2026 · 31 albums" */
  subline: string;
  /** "Part 1 / 2" — only when the export has several pages. */
  part?: string;
  /** "Albums 1–16 of 31" — only when the export has several pages. */
  range?: string;
  site: string;
}

export interface RenderNewAlbumsPageOptions {
  entries: NewAlbumsExportEntry[];
  covers: (CanvasImageSource | null)[];
  logo: HTMLImageElement | null;
  palette: NewAlbumsExportPalette;
  strings: NewAlbumsExportPageStrings;
}

const LOGO_H = 40;
const LOGO_TOP = 38;
const HEADING_TOP = 28;
const SUBLINE_TOP = 102;
const HEADER_GAP = 24;
const RULE_H = 2;
const FOOTER_H = 52;

interface EntryLayout {
  artist: string[];
  title: string[];
  meta: string;
  height: number;
}

function layoutEntry(ctx: CanvasRenderingContext2D, e: NewAlbumsExportEntry): EntryLayout {
  const measure = (s: string) => ctx.measureText(s).width;
  ctx.font = exportFont(T.artist);
  const artist = wrapText(e.artist, TEXT_W, measure);
  ctx.font = exportFont(T.title);
  const title = wrapText(e.title, TEXT_W, measure);
  const meta = albumMetaLine(e.year, e.genre);
  const height = artist.length * T.artist.lineHeight + 2 + title.length * T.title.lineHeight
    + (meta ? 2 + T.meta.lineHeight : 0);
  return { artist, title, meta, height };
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, r);
}

function drawCover(ctx: CanvasRenderingContext2D, cover: CanvasImageSource | null, x: number, y: number, p: NewAlbumsExportPalette) {
  roundedRect(ctx, x, y, G.cover, G.coverRadius);
  ctx.fillStyle = p.placeholder;
  ctx.fill();
  if (cover) {
    ctx.save();
    roundedRect(ctx, x, y, G.cover, G.coverRadius);
    ctx.clip();
    ctx.drawImage(cover, x, y, G.cover, G.cover);
    ctx.restore();
    return;
  }
  // Calm placeholder: a record outline, no text.
  const cx = x + G.cover / 2;
  const cy = y + G.cover / 2;
  ctx.strokeStyle = p.placeholderMark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = p.placeholderMark;
  ctx.fill();
}

function drawEntryText(ctx: CanvasRenderingContext2D, l: EntryLayout, x: number, y: number, p: NewAlbumsExportPalette) {
  let ty = y;
  ctx.font = exportFont(T.artist);
  ctx.fillStyle = p.accent;
  for (const line of l.artist) { ctx.fillText(line, x, ty + T.artist.baseline); ty += T.artist.lineHeight; }
  ty += 2;
  ctx.font = exportFont(T.title);
  ctx.fillStyle = p.text;
  for (const line of l.title) { ctx.fillText(line, x, ty + T.title.baseline); ty += T.title.lineHeight; }
  if (l.meta) {
    ty += 2;
    ctx.font = exportFont(T.meta);
    ctx.fillStyle = p.meta;
    ctx.fillText(l.meta, x, ty + T.meta.baseline);
  }
}

export function renderNewAlbumsPage(opts: RenderNewAlbumsPageOptions): HTMLCanvasElement {
  const { entries, covers, logo, palette: p, strings } = opts;
  const W = G.width;
  const measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) throw new Error('canvas 2d unavailable');

  // ── Measure ─────────────────────────────────────────────────────────────
  const logoW = logo && logo.naturalHeight ? Math.round(LOGO_H * (logo.naturalWidth / logo.naturalHeight)) : 0;
  const headingMax = W - 2 * G.padX - (logoW ? logoW + 32 : 0);
  let headingSize = T.heading.size;
  measureCtx.font = exportFont(T.heading, headingSize);
  while (measureCtx.measureText(strings.heading).width > headingMax && headingSize > 40) {
    headingSize -= 2;
    measureCtx.font = exportFont(T.heading, headingSize);
  }

  measureCtx.font = exportFont(T.subline);
  const partW = strings.part ? measureCtx.measureText(strings.part).width + HEADER_GAP : 0;
  const sublineLines = wrapText(strings.subline, W - 2 * G.padX - partW, s => measureCtx.measureText(s).width);
  const ruleY = SUBLINE_TOP + sublineLines.length * T.subline.lineHeight + 19;
  const gridTop = ruleY + RULE_H + 21;

  const rows: { entries: NewAlbumsExportEntry[]; layouts: EntryLayout[]; height: number }[] = [];
  for (let i = 0; i < entries.length; i += 2) {
    const pair = entries.slice(i, i + 2);
    const layouts = pair.map(e => layoutEntry(measureCtx, e));
    rows.push({ entries: pair, layouts, height: Math.max(G.cover, ...layouts.map(l => l.height)) });
  }
  const gridH = rows.reduce((sum, r) => sum + r.height + 2 * G.rowPad + 1, 0);
  const H = gridTop + gridH + FOOTER_H;

  // ── Paint ───────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = p.background;
  ctx.fillRect(0, 0, W, H);

  if (logo && logoW) ctx.drawImage(logo, W - G.padX - logoW, LOGO_TOP, logoW, LOGO_H);
  ctx.font = exportFont(T.heading, headingSize);
  ctx.fillStyle = p.text;
  ctx.fillText(strings.heading, G.padX, HEADING_TOP + T.heading.baseline);

  ctx.font = exportFont(T.subline);
  if (strings.part) {
    ctx.textAlign = 'right';
    ctx.fillStyle = p.accent;
    ctx.fillText(strings.part, W - G.padX, SUBLINE_TOP + T.subline.baseline);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = p.meta;
  sublineLines.forEach((line, i) => {
    ctx.fillText(line, G.padX, SUBLINE_TOP + T.subline.baseline + i * T.subline.lineHeight);
  });
  ctx.fillStyle = p.accent;
  ctx.fillRect(G.padX, ruleY, W - 2 * G.padX, RULE_H);

  let y = gridTop;
  let index = 0;
  for (const row of rows) {
    row.entries.forEach((_, col) => {
      const x = G.padX + col * (COL_W + G.columnGap);
      drawCover(ctx, covers[index] ?? null, x, y, p);
      drawEntryText(ctx, row.layouts[col], x + G.cover + G.textGap, y, p);
      index += 1;
    });
    y += row.height + G.rowPad;
    ctx.fillStyle = p.rule;
    row.entries.forEach((_, col) => ctx.fillRect(G.padX + col * (COL_W + G.columnGap), y, COL_W, 1));
    y += 1 + G.rowPad;
  }

  ctx.font = exportFont(T.footer);
  ctx.fillStyle = p.meta;
  const footerBaseline = H - FOOTER_H + 30;
  ctx.fillText(strings.site, G.padX, footerBaseline);
  if (strings.range) {
    ctx.textAlign = 'right';
    ctx.fillText(strings.range, W - G.padX, footerBaseline);
    ctx.textAlign = 'left';
  }
  return canvas;
}
