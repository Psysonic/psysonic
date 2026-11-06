import { albumExportCoverRef, loadCoverBlobForExport } from '@/cover/integrations/export';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import i18n from '@/lib/i18n';
import { usableLocale } from '@/lib/format/localeTag';
import { albumArtistDisplayName } from '@/features/album/utils/deriveAlbumHeaderArtistRefs';
import { loadWordmark } from '@/features/album/utils/exportAlbumCard';
import { writeFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { resolveNewAlbumsExportFolder } from './newAlbumsExportFolder';
import {
  NEW_ALBUMS_EXPORT_GEOMETRY,
  NEW_ALBUMS_EXPORT_PALETTES,
  NEW_ALBUMS_EXPORT_TYPE,
  exportFont,
  paginateEvenly,
  type NewAlbumsExportScheme,
} from './newAlbumsExportLayout';
import { renderNewAlbumsPage, type NewAlbumsExportEntry, type NewAlbumsExportPageStrings } from './newAlbumsExportRender';

export interface ExportNewAlbumsOptions {
  /** Already filtered and sorted (see `albumsAddedSince`). */
  albums: SubsonicAlbum[];
  /** Start of the export window in ms — shown in the date line. */
  since: number;
  scheme: NewAlbumsExportScheme;
  /** Called before each image is drawn (1-based page, total pages). */
  onProgress?: (page: number, pages: number) => void;
}

/** Cover tier: 256 px source for a 108 px tile, whatever the screen's pixel ratio. */
const COVER_SOURCE_PX = 216;

async function loadCoverBitmap(album: SubsonicAlbum): Promise<ImageBitmap | null> {
  const ref = albumExportCoverRef(album);
  if (!ref) return null;
  try {
    // `loadCoverBlobForExport` multiplies by devicePixelRatio; undo that so the
    // tier stays fixed and every export renders the same.
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const blob = await loadCoverBlobForExport(ref, COVER_SOURCE_PX / dpr);
    return blob ? await createImageBitmap(blob) : null;
  } catch {
    return null;
  }
}

function toEntry(album: SubsonicAlbum): NewAlbumsExportEntry {
  return { artist: albumArtistDisplayName(album), title: album.name, year: album.year, genre: album.genre };
}

/** Waits for the Inter subsets this page's text needs, so the canvas never paints a fallback face. */
async function ensureFonts(text: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const styles = Object.values(NEW_ALBUMS_EXPORT_TYPE);
  await Promise.all(styles.map(s => document.fonts.load(exportFont(s), text).catch(() => [])));
  await document.fonts.ready;
}

function formatSinceDate(since: number, locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(since));
}

function pageStrings(total: number, since: number, pageNum: number, pageCount: number, from: number, to: number): NewAlbumsExportPageStrings {
  const t = i18n.t.bind(i18n);
  const locale = usableLocale(i18n.resolvedLanguage ?? i18n.language);
  const date = formatSinceDate(since, locale);
  const multi = pageCount > 1;
  return {
    heading: t('albumExport.heading'),
    subline: `${t('albumExport.since', { date })}  ·  ${t('albumExport.albumCount', { count: total })}`,
    part: multi ? t('albumExport.part', { page: pageNum, pages: pageCount }) : undefined,
    range: multi ? t('albumExport.range', { from, to, total }) : undefined,
    site: 'psysonic.de',
  };
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png');
  });
}

export async function exportNewAlbumsImage(opts: ExportNewAlbumsOptions): Promise<{ count: number; paths: string[] } | null> {
  const { albums, since, scheme, onProgress } = opts;
  if (albums.length === 0) return null;

  const palette = NEW_ALBUMS_EXPORT_PALETTES[scheme];
  const pages = paginateEvenly(albums, NEW_ALBUMS_EXPORT_GEOMETRY.maxPerPage);
  const logo = await loadWordmark(palette.text).catch(() => null);

  const now = new Date();
  const folder = await resolveNewAlbumsExportFolder();
  const timestamp = now.toISOString().slice(0, 10);
  const paths: string[] = [];

  let offset = 0;
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    onProgress?.(p + 1, pages.length);
    const entries = page.map(toEntry);
    const strings = pageStrings(albums.length, since, p + 1, pages.length, offset + 1, offset + page.length);
    const allText = [strings.heading, strings.subline, strings.part, strings.range, strings.site,
      ...entries.flatMap(e => [e.artist, e.title, e.genre ?? '', e.year ? String(e.year) : ''])].join(' ');
    const [covers] = await Promise.all([Promise.all(page.map(loadCoverBitmap)), ensureFonts(allText)]);

    const canvas = renderNewAlbumsPage({ entries, covers, logo, palette, strings });
    covers.forEach(c => c?.close());
    const blob = await canvasToPng(canvas);
    const suffix = pages.length > 1 ? `-${p + 1}` : '';
    const filePath = await join(folder, `psysonic-new-albums-${timestamp}${suffix}.png`);
    await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
    paths.push(filePath);
    offset += page.length;
  }

  return { count: albums.length, paths };
}
