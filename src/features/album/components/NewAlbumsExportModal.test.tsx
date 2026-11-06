import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';

const loadNewestAlbums = vi.fn<() => Promise<SubsonicAlbum[]>>();
vi.mock('@/features/album/utils/newAlbumsSince', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/album/utils/newAlbumsSince')>()),
  loadNewestAlbums: () => loadNewestAlbums(),
}));

const openFolder = vi.fn<(folder: string) => Promise<void>>(() => Promise.resolve());
vi.mock('@/features/album/utils/newAlbumsExportFolder', () => ({
  resolveNewAlbumsExportFolder: () => Promise.resolve('/home/tester/Downloads'),
  openNewAlbumsExportFolder: (folder: string) => openFolder(folder),
}));

type ExportOpts = {
  albums: SubsonicAlbum[];
  since: number;
  scheme: string;
  onProgress?: (page: number, pages: number) => void;
};
const exportNewAlbumsImage = vi.fn<(opts: ExportOpts) => Promise<{ count: number; paths: string[] } | null>>();
vi.mock('@/features/album/utils/exportNewAlbums', () => ({
  exportNewAlbumsImage: (opts: ExportOpts) => exportNewAlbumsImage(opts),
}));

import NewAlbumsExportModal from '@/features/album/components/NewAlbumsExportModal';

const album = (id: string, created: string) =>
  ({ id, artist: `artist ${id}`, name: `album ${id}`, created }) as SubsonicAlbum;

function albumsFrom(dateIso: string, n: number) {
  return Array.from({ length: n }, (_, i) => album(String(i), `${dateIso}T12:00:00`));
}

function setDate(value: string) {
  fireEvent.change(screen.getByLabelText('Since'), { target: { value } });
}

const exportButton = () => screen.getByRole('button', { name: 'Export' });

describe('NewAlbumsExportModal', () => {
  // Block body on purpose: a function returned from beforeEach runs as teardown,
  // and mockReset returns the mock itself.
  beforeEach(() => {
    loadNewestAlbums.mockReset();
    exportNewAlbumsImage.mockReset();
  });

  it('counts the albums and shows how they split into images', async () => {
    loadNewestAlbums.mockResolvedValue(albumsFrom('2026-11-04', 31));
    renderWithProviders(<NewAlbumsExportModal onClose={vi.fn()} />);
    setDate('2026-11-03');
    expect(await screen.findByText('31 albums · makes 2 images')).toBeInTheDocument();
    expect(loadNewestAlbums).toHaveBeenCalledTimes(1);
  });

  it('keeps export disabled while counting', async () => {
    let finish: (albums: SubsonicAlbum[]) => void = () => {};
    loadNewestAlbums.mockImplementation(() => new Promise(r => { finish = r; }));
    renderWithProviders(<NewAlbumsExportModal onClose={vi.fn()} />);
    expect(screen.getByText('Counting albums…')).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
    expect(exportButton()).toHaveAttribute('aria-busy', 'true');
    setDate('2026-11-03');
    await act(async () => finish(albumsFrom('2026-11-04', 2)));
    expect(exportButton()).toBeEnabled();
  });

  it('disables export when nothing was added since the date', async () => {
    loadNewestAlbums.mockResolvedValue(albumsFrom('2026-10-01', 3));
    renderWithProviders(<NewAlbumsExportModal onClose={vi.fn()} />);
    setDate('2026-11-03');
    expect(await screen.findByText('No albums added since this date')).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
  });

  it('stays open while exporting, shows progress, then the result', async () => {
    loadNewestAlbums.mockResolvedValue(albumsFrom('2026-11-04', 2));
    let finish: (v: { count: number; paths: string[] }) => void = () => {};
    exportNewAlbumsImage.mockImplementation(opts => {
      opts.onProgress?.(1, 1);
      return new Promise(r => { finish = r; });
    });
    const onClose = vi.fn();
    renderWithProviders(<NewAlbumsExportModal onClose={onClose} />);
    setDate('2026-11-03');
    await screen.findByText(/2 albums/);
    await userEvent.click(screen.getByRole('button', { name: 'Light' }));
    await userEvent.click(exportButton());

    expect(await screen.findByText('Creating image 1 of 1…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    const req = exportNewAlbumsImage.mock.calls[0][0];
    expect(req.scheme).toBe('light');
    expect(req.since).toBe(new Date('2026-11-03T00:00:00').getTime());
    expect(req.albums).toHaveLength(2);

    await act(async () => finish({ count: 2, paths: ['/home/tester/Downloads/a.png'] }));
    expect(screen.getByText('Exported 2 albums as 1 image')).toBeInTheDocument();
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    await userEvent.click(closeButtons[closeButtons.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a failure in the dialog and lets the user try again', async () => {
    loadNewestAlbums.mockResolvedValue(albumsFrom('2026-11-04', 1));
    exportNewAlbumsImage.mockImplementation(() => Promise.reject(new Error('disk full')));
    renderWithProviders(<NewAlbumsExportModal onClose={vi.fn()} />);
    setDate('2026-11-03');
    await screen.findByText(/1 album/);
    await userEvent.click(exportButton());
    expect(await screen.findByText('Export failed: disk full')).toBeInTheDocument();
    expect(exportButton()).toBeEnabled();
  });

  it('still allows export when counting fails', async () => {
    loadNewestAlbums.mockImplementation(() => Promise.reject(new Error('offline')));
    renderWithProviders(<NewAlbumsExportModal onClose={vi.fn()} />);
    expect(await screen.findByText('Couldn’t count the albums. You can still export.')).toBeInTheDocument();
    expect(exportButton()).toBeEnabled();
  });

  it('shows where the images go and opens that folder', async () => {
    loadNewestAlbums.mockResolvedValue([]);
    renderWithProviders(<NewAlbumsExportModal onClose={vi.fn()} />);
    expect(await screen.findByText('/home/tester/Downloads')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(openFolder).toHaveBeenCalledWith('/home/tester/Downloads');
  });

  it('closes on Escape when idle', async () => {
    loadNewestAlbums.mockResolvedValue([]);
    const onClose = vi.fn();
    renderWithProviders(<NewAlbumsExportModal onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
