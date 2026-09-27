/**
 * `QueuePanel` characterization (Phase F5b).
 *
 * Includes the §4.4 regression test from the v2 plan — queue DnD must
 * NOT use HTML5 native `dataTransfer.setData`/`draggable=true`. The
 * project's custom `psy-drop` system sidesteps WebView2's
 * `text/plain`-only restriction by avoiding HTML5 DnD entirely; a
 * refactor that re-introduces native DnD would silently break Windows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/subsonic', () => ({
  savePlayQueue: vi.fn(async () => undefined),
  getPlayQueue: vi.fn(async () => ({ songs: [], current: undefined, position: 0 })),
  buildStreamUrl: vi.fn((id: string) => `https://mock/stream/${id}`),
  buildCoverArtUrl: vi.fn((id: string) => `https://mock/cover/${id}`),
  buildDownloadUrl: vi.fn((id: string) => `https://mock/download/${id}`),
  coverArtCacheKey: vi.fn((id: string, size = 256) => `mock:cover:${id}:${size}`),
  getSong: vi.fn(async () => null),
  getRandomSongs: vi.fn(async () => []),
  getSimilarSongs2: vi.fn(async () => []),
  getTopSongs: vi.fn(async () => []),
  getAlbumInfo2: vi.fn(async () => null),
  reportNowPlaying: vi.fn(async () => undefined),
  scrobbleSong: vi.fn(async () => undefined),
}));


const starMock = vi.hoisted(() => vi.fn(async () => undefined));
const unstarMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/api/subsonicStarRating', () => ({
  star: starMock,
  unstar: unstarMock,
  setRating: vi.fn(async () => undefined),
}));

vi.mock('@/features/orbit/utils/orbitBulkGuard', () => ({
  orbitBulkGuard: vi.fn(async () => true),
}));

// Tests render without a DragDropProvider, so the context's own `startDrag` is a
// no-op. Record it instead, to see what a row drag hands over.
const startDragMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/dnd/DragDropContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dnd/DragDropContext')>()),
  useDragDrop: () => ({ isDragging: false, payload: null, startDrag: startDragMock }),
}));

import QueuePanel from '@/features/queue/components/QueuePanel';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { usePlaylistStore } from '@/features/playlist';
import * as offlineApi from '@/features/offline';
import { resetAllStores } from '@/test/helpers/storeReset';
import { makeTrack, makeTracks, seedQueue } from '@/test/helpers/factories';
import { onInvoke, registerDefaultCoverInvokeHandlers } from '@/test/mocks/tauri';
import { appendTimelineSessionPlay } from '@/features/playback/store/timelineSessionHistory';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

beforeEach(() => {
  resetAllStores();
  const id = useAuthStore.getState().addServer({
    name: 'T', url: 'https://x.test', username: 'u', password: 'p',
  });
  useAuthStore.getState().setActiveServer(id);
  usePlaylistStore.setState({ playlists: [], playlistsLoading: false, recentIds: [], lastModified: {} });
  registerDefaultCoverInvokeHandlers();
  onInvoke('audio_play', () => undefined);
  onInvoke('audio_pause', () => undefined);
  onInvoke('audio_stop', () => undefined);
  onInvoke('audio_seek', () => undefined);
  onInvoke('audio_get_state', () => ({ playing: false }));
  onInvoke('audio_update_replay_gain', () => undefined);
  onInvoke('discord_update_presence', () => undefined);
  onInvoke('library_get_recent_play_sessions', () => []);
});

describe('QueuePanel — render surface', () => {
  // jsdom has no layout, so the virtualized QueueList sees a 0px viewport and
  // renders nothing. @tanstack/virtual-core measures via offsetHeight, so give
  // the scroll viewport a height and rows a fixed height — then the virtualizer
  // produces rows the way it does in the browser.
  let offsetSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    offsetSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('queue-list') ? 600 : 52;
      });
    // These characterize the full-queue rendering (one row per track), which is
    // playlist mode. The default mode is 'queue' (upcoming-only), so pin it.
    useAuthStore.getState().setQueueDisplayMode('playlist');
  });
  afterEach(() => offsetSpy.mockRestore());

  it('renders an empty-queue affordance when the queue is empty', () => {
    const { container } = renderWithProviders(<QueuePanel />);
    expect(container.querySelector('.queue-panel')).not.toBeNull();
    // No queue rows present.
    expect(container.querySelectorAll('[data-queue-idx]').length).toBe(0);
  });

  it('renders one row per queue track with the matching data-queue-idx', () => {
    const tracks = makeTracks(3);
    seedQueue(tracks, { index: 0, currentTrack: tracks[0] });
    const { container } = renderWithProviders(<QueuePanel />);
    const rows = container.querySelectorAll<HTMLElement>('[data-queue-idx]');
    expect(rows.length).toBe(3);
    expect(rows[0]?.getAttribute('data-queue-idx')).toBe('0');
    expect(rows[2]?.getAttribute('data-queue-idx')).toBe('2');
  });

  it('renders each queue row with the track title text', () => {
    const t1 = makeTrack({ id: 'q1', title: 'Test Song A' });
    const t2 = makeTrack({ id: 'q2', title: 'Test Song B' });
    seedQueue([t1, t2], { index: 0, currentTrack: t1 });
    const { getAllByText, getByText } = renderWithProviders(<QueuePanel />);
    // Title A appears both in the now-playing section and in the row;
    // assert at least one match. Title B only lives in its row.
    expect(getAllByText('Test Song A').length).toBeGreaterThan(0);
    expect(getByText('Test Song B')).toBeInTheDocument();
  });
});

describe('QueuePanel — display mode', () => {
  // Same virtualizer layout shim as the render-surface block: jsdom has no
  // layout, so give the scroll viewport a height and rows a fixed height.
  let offsetSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    offsetSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('queue-list') ? 600 : 52;
      });
  });
  afterEach(() => offsetSpy.mockRestore());

  it('playlist mode: header reads "Playlist", full queue renders, no "Next Tracks" divider', () => {
    const tracks = makeTracks(4);
    useAuthStore.getState().setQueueDisplayMode('playlist');
    seedQueue(tracks, { index: 1, currentTrack: tracks[1] });
    const { container } = renderWithProviders(<QueuePanel />);
    expect(container.querySelector('.queue-header h2')?.textContent).toBe('Playlist');
    const idxs = [...container.querySelectorAll('[data-queue-idx]')].map(r => r.getAttribute('data-queue-idx'));
    expect(idxs).toEqual(['0', '1', '2', '3']);
    expect(container.textContent).not.toContain('Next Tracks');
  });

  it('playlist mode: rows before the current track are dimmed, the current and upcoming rows are not', () => {
    const tracks = makeTracks(4);
    useAuthStore.getState().setQueueDisplayMode('playlist');
    seedQueue(tracks, { index: 2, currentTrack: tracks[2] });
    const { container } = renderWithProviders(<QueuePanel />);
    const opacities = [...container.querySelectorAll<HTMLElement>('[data-queue-idx]')].map(r => r.style.opacity);
    expect(opacities).toEqual(['0.5', '0.5', '', '']);
  });

  it('queue mode: header reads "Queue", only upcoming rows render with absolute indices + titles', () => {
    const tracks = makeTracks(5);
    useAuthStore.getState().setQueueDisplayMode('queue');
    seedQueue(tracks, { index: 1, currentTrack: tracks[1] });
    const { container } = renderWithProviders(<QueuePanel />);
    expect(container.querySelector('.queue-header h2')?.textContent).toBe('Queue');
    const rows = [...container.querySelectorAll<HTMLElement>('[data-queue-idx]')];
    // Played (0) + current (1) are gone; only 2,3,4 remain, with absolute idx.
    expect(rows.map(r => r.getAttribute('data-queue-idx'))).toEqual(['2', '3', '4']);
    // The first displayed row maps to the absolute track at index 2, not 0.
    expect(rows[0]?.textContent).toContain(tracks[2].title);
    expect(container.textContent).toContain('Next Tracks');
  });

  it('queue mode with the current track last: shows the "no upcoming" empty state, no rows', () => {
    const tracks = makeTracks(3);
    useAuthStore.getState().setQueueDisplayMode('queue');
    seedQueue(tracks, { index: 2, currentTrack: tracks[2] });
    const { container } = renderWithProviders(<QueuePanel />);
    expect(container.querySelectorAll('[data-queue-idx]').length).toBe(0);
    expect(container.textContent).toContain('No upcoming tracks');
  });

  it('header mode-toggle button advances queueDisplayMode (default queue → timeline)', () => {
    seedQueue(makeTracks(3), { index: 0, currentTrack: makeTrack() });
    const { container } = renderWithProviders(<QueuePanel />);
    const toggle = container.querySelector<HTMLButtonElement>('.queue-header .queue-action-btn');
    expect(toggle?.getAttribute('aria-label')).toBe('Timeline');
    toggle!.click();
    expect(useAuthStore.getState().queueDisplayMode).toBe('timeline');
  });

  it('timeline mode: renders current + upcoming only (not played queue prefix)', () => {
    const tracks = makeTracks(4);
    useAuthStore.getState().setQueueDisplayMode('timeline');
    seedQueue(tracks, { index: 1, currentTrack: tracks[1] });
    const { container } = renderWithProviders(<QueuePanel />);
    const idxs = [...container.querySelectorAll('[data-queue-idx]')].map(r => r.getAttribute('data-queue-idx'));
    expect(idxs).toEqual(['1', '2', '3']);
  });

  it('timeline history context menu captures playback order from that occurrence', () => {
    const tracks = makeTracks(4);
    const serverId = useAuthStore.getState().activeServerId!;
    useAuthStore.getState().setQueueDisplayMode('timeline');
    seedQueue(tracks, { index: 1, currentTrack: tracks[1], serverId });
    const historyRef = usePlayerStore.getState().queueItems[0]!;
    appendTimelineSessionPlay({
      serverId: historyRef.serverId,
      trackId: historyRef.trackId,
      playedAtMs: 1,
    });
    const { container } = renderWithProviders(<QueuePanel />);
    const historyRow = container.querySelector<HTMLElement>('[data-timeline-kind="history"]');

    expect(historyRow).not.toBeNull();
    fireEvent.contextMenu(historyRow!);

    const menu = usePlayerStore.getState().contextMenu;
    expect(menu.type).toBe('song');
    expect(menu.timelineFromHereRefs?.map(ref => ref.trackId)).toEqual(
      tracks.map(track => track.id),
    );
  });
});

describe('QueuePanel — toolbar', () => {
  it('exposes Shuffle / Playlist / Share Queue / Clear / AutoDJ via aria-label', () => {
    const tracks = makeTracks(3);
    seedQueue(tracks, { index: 0, currentTrack: tracks[0] });
    const { getByLabelText } = renderWithProviders(<QueuePanel />);
    expect(getByLabelText('Shuffle queue')).toBeInTheDocument();
    expect(getByLabelText('Playlist')).toBeInTheDocument();
    expect(getByLabelText('Copy queue share link')).toBeInTheDocument();
    expect(getByLabelText('Clear queue')).toBeInTheDocument();
    expect(getByLabelText('AutoDJ')).toBeInTheDocument();
  });

  it('Save and Load live inside the Playlist submenu, not directly on the toolbar', () => {
    const tracks = makeTracks(3);
    seedQueue(tracks, { index: 0, currentTrack: tracks[0] });
    const { getByLabelText, container } = renderWithProviders(<QueuePanel />);
    // The submenu is closed initially.
    expect(container.querySelector('.queue-menu')).toBeNull();
    fireEvent.click(getByLabelText('Playlist'));
    const menu = container.querySelector('.queue-menu');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain('Save Playlist');
    expect(menu?.textContent).toContain('Load Playlist');
  });

  it('Shuffle button toggles the player shuffle mode and switching it off restores the order', () => {
    const tracks = makeTracks(6);
    seedQueue(tracks, { index: 1, currentTrack: tracks[1] });
    const original = usePlayerStore.getState().queueItems.map(ref => ref.trackId);
    const { getByLabelText } = renderWithProviders(<QueuePanel />);
    const shuffle = getByLabelText('Shuffle queue');
    expect(shuffle.getAttribute('aria-pressed')).toBe('false');

    act(() => { fireEvent.click(shuffle); });

    const on = usePlayerStore.getState();
    expect(on.shuffleMode).toBe(true);
    expect(shuffle.getAttribute('aria-pressed')).toBe('true');
    // Played and current rows stay put; only the upcoming tail is reordered.
    expect(on.queueItems.slice(0, 2).map(ref => ref.trackId)).toEqual(original.slice(0, 2));
    expect([...on.queueItems.map(ref => ref.trackId)].sort()).toEqual([...original].sort());
    expect(on.queueIndex).toBe(1);

    act(() => { fireEvent.click(shuffle); });

    const off = usePlayerStore.getState();
    expect(off.shuffleMode).toBe(false);
    expect(off.queueItems.map(ref => ref.trackId)).toEqual(original);
    expect(shuffle.getAttribute('aria-pressed')).toBe('false');
  });

  it('closes a pending save modal when the queue is cleared', () => {
    const track = makeTrack();
    seedQueue([track], { index: 0, currentTrack: track });
    const { getByLabelText, getByText, queryByRole } = renderWithProviders(<QueuePanel />);

    fireEvent.click(getByLabelText('Playlist'));
    fireEvent.click(getByText('Save Playlist'));
    expect(queryByRole('dialog')).toBeInTheDocument();

    fireEvent.click(getByLabelText('Clear queue'));
    expect(queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('right-clicking Clear keeps only the active track playing', () => {
    const tracks = makeTracks(3);
    seedQueue(tracks, { index: 1, currentTrack: tracks[1] });
    usePlayerStore.setState({ isPlaying: true, currentTime: 42 });
    const { getByLabelText } = renderWithProviders(<QueuePanel />);

    fireEvent.contextMenu(getByLabelText('Clear queue'));

    const state = usePlayerStore.getState();
    expect(state.queueItems.map(ref => ref.trackId)).toEqual([tracks[1].id]);
    expect(state.queueIndex).toBe(0);
    expect(state.currentTrack).toBe(tracks[1]);
    expect(state.isPlaying).toBe(true);
    expect(state.currentTime).toBe(42);
  });

  it('keeps the latest playlist load when an older request resolves last', async () => {
    const serverId = useAuthStore.getState().activeServerId ?? undefined;
    const playlistA = { id: 'a', serverId, name: 'Playlist A', songCount: 0, duration: 0, created: '', changed: '' };
    const playlistB = { id: 'b', serverId, name: 'Playlist B', songCount: 0, duration: 0, created: '', changed: '' };
    seedQueue([makeTrack({ id: 'existing', serverId })], { index: 0, currentTrack: makeTrack({ id: 'existing', serverId }) });
    usePlaylistStore.setState({
      playlists: [playlistA, playlistB],
      fetchPlaylists: vi.fn(async () => undefined),
    });
    type ResolvedPlaylist = Awaited<ReturnType<typeof offlineApi.resolvePlaylist>>;
    let resolveA!: (value: ResolvedPlaylist) => void;
    let resolveB!: (value: ResolvedPlaylist) => void;
    const resolveSpy = vi.spyOn(offlineApi, 'resolvePlaylist').mockImplementation((_serverId, playlistId) => {
      if (playlistId === 'a') return new Promise(resolve => { resolveA = resolve; });
      return new Promise(resolve => { resolveB = resolve; });
    });

    try {
      const { container, getByLabelText, getByText, queryByText } = renderWithProviders(<QueuePanel />);
      fireEvent.click(getByLabelText('Playlist'));
      fireEvent.click(getByText('Load Playlist'));

      await waitFor(() => expect(container.querySelectorAll('.modal-content .nav-btn')).toHaveLength(6));
      const buttons = container.querySelectorAll<HTMLButtonElement>('.modal-content .nav-btn');
      fireEvent.click(buttons[0]);
      fireEvent.click(buttons[3]);

      await act(async () => {
        resolveB({ playlist: playlistB, songs: [] });
        await Promise.resolve();
      });
      expect(getByText('Playlist B')).toBeInTheDocument();
      expect(usePlayerStore.getState().queueItems).toEqual([]);

      await act(async () => {
        resolveA({ playlist: playlistA, songs: [] });
        await Promise.resolve();
      });
      expect(getByText('Playlist B')).toBeInTheDocument();
      expect(queryByText('Playlist A')).not.toBeInTheDocument();
    } finally {
      resolveSpy.mockRestore();
    }
  });
});

describe('QueuePanel — DnD architecture pin (§4.4 of v2 plan)', () => {
  // The custom `psy-drop` event system in DragDropContext sidesteps
  // WebView2's `text/plain`-only DnD restriction by avoiding HTML5 native
  // DnD entirely. These tests make sure a refactor that "modernises" the
  // queue back to native HTML5 DnD breaks loudly.

  it('queue rows do not declare draggable=true (no HTML5 native drag)', () => {
    seedQueue(makeTracks(3), { index: 0, currentTrack: makeTrack() });
    const { container } = renderWithProviders(<QueuePanel />);
    const rows = container.querySelectorAll<HTMLElement>('[data-queue-idx]');
    for (const row of rows) {
      expect(row.getAttribute('draggable')).not.toBe('true');
    }
  });

  it('the source file has no `dataTransfer.setData` / `dataTransfer.getData` / `onDragStart` / `onDrop` JSX usage', () => {
    // Static check — protect against re-introducing native DnD. The
    // `dragenter` / `dragover` props are allowed because the document
    // listens for them to render the drop indicator without acting as
    // a sink for HTML5 payloads.
    const source = readFileSync(join(process.cwd(), 'src/features/queue/components/QueuePanel.tsx'), 'utf8');
    expect(source).not.toMatch(/dataTransfer\.setData/);
    expect(source).not.toMatch(/dataTransfer\.getData/);
    expect(source).not.toMatch(/\bonDragStart\s*=/);
    expect(source).not.toMatch(/\bonDrop\s*=/);
  });

  it('the source file does not use `application/json` MIME anywhere (WebView2 restriction)', () => {
    const source = readFileSync(join(process.cwd(), 'src/features/queue/components/QueuePanel.tsx'), 'utf8');
    expect(source).not.toMatch(/application\/json/);
  });
});

describe('QueuePanel — row favourite toggle', () => {
  // Same virtualizer layout shim as the blocks above: jsdom has no layout.
  let offsetSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    offsetSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('queue-list') ? 600 : 52;
      });
    useAuthStore.getState().setQueueDisplayMode('playlist');
    starMock.mockClear();
    unstarMock.mockClear();
  });
  afterEach(() => offsetSpy.mockRestore());

  it('favourites a row without starting it', async () => {
    const tracks = makeTracks(3);
    seedQueue(tracks, { index: 0, currentTrack: tracks[0] });
    const { container } = renderWithProviders(<QueuePanel />);

    const row = container.querySelectorAll<HTMLElement>('[data-queue-idx]')[2];
    const heart = row.querySelector<HTMLElement>('.queue-item-star')!;
    act(() => { fireEvent.click(heart); });

    await waitFor(() => expect(starMock).toHaveBeenCalledTimes(1));
    // The row itself plays on click — the button has to keep that from firing.
    expect(usePlayerStore.getState().queueIndex).toBe(0);
  });

  it('shows the hearts by default and hides them when the setting is off', () => {
    const tracks = makeTracks(2);
    seedQueue(tracks, { index: 0, currentTrack: tracks[0] });
    const first = renderWithProviders(<QueuePanel />);
    expect(first.container.querySelectorAll('.queue-item-star').length).toBe(2);
    first.unmount();

    act(() => { useAuthStore.setState({ queueRowFavoriteButton: false }); });
    const second = renderWithProviders(<QueuePanel />);
    expect(second.container.querySelectorAll('.queue-item-star').length).toBe(0);
  });
  it('takes a favourite back off a row that already has one', async () => {
    const tracks = makeTracks(2).map(track => ({ ...track, starred: '2026-01-01T00:00:00Z' }));
    seedQueue(tracks, { index: 0, currentTrack: tracks[0] });
    const { container } = renderWithProviders(<QueuePanel />);

    const row = container.querySelectorAll<HTMLElement>('[data-queue-idx]')[1];
    const heart = row.querySelector<HTMLElement>('.queue-item-star')!;
    expect(heart.className).toContain('is-starred');

    act(() => { fireEvent.click(heart); });

    await waitFor(() => expect(unstarMock).toHaveBeenCalledTimes(1));
  });
});

describe('QueuePanel — multi-select', () => {
  // Same virtualizer layout shim as the blocks above: jsdom has no layout.
  let offsetSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    offsetSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('queue-list') ? 600 : 52;
      });
    useAuthStore.getState().setQueueDisplayMode('playlist');
    startDragMock.mockClear();
  });
  afterEach(() => offsetSpy.mockRestore());

  const rowsOf = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>('[data-queue-idx]')];

  const dragRow = (row: HTMLElement) => {
    fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 10, clientY: 40 });
  };

  it('drags the whole selection when a selected row is grabbed', () => {
    const tracks = makeTracks(4);
    seedQueue(tracks, { index: 0, currentTrack: tracks[0] });
    const { container } = renderWithProviders(<QueuePanel />);
    fireEvent.click(rowsOf(container)[1]!, { ctrlKey: true });
    fireEvent.click(rowsOf(container)[3]!, { ctrlKey: true });

    dragRow(rowsOf(container)[3]!);

    expect(startDragMock).toHaveBeenCalledTimes(1);
    const [payload] = startDragMock.mock.calls[0]!;
    expect(JSON.parse(payload.data)).toEqual({ type: 'queue_reorder', index: 3, indices: [1, 3] });
    expect(payload.label).toBe('2 tracks');
  });

  it('drags only the grabbed row and drops the selection when an unselected row is grabbed', () => {
    const tracks = makeTracks(4);
    seedQueue(tracks, { index: 0, currentTrack: tracks[0] });
    const { container } = renderWithProviders(<QueuePanel />);
    fireEvent.click(rowsOf(container)[1]!, { ctrlKey: true });
    fireEvent.click(rowsOf(container)[3]!, { ctrlKey: true });

    dragRow(rowsOf(container)[2]!);

    const [payload] = startDragMock.mock.calls[0]!;
    expect(JSON.parse(payload.data)).toEqual({ type: 'queue_reorder', index: 2 });
    expect(rowsOf(container).some(row => row.classList.contains('bulk-selected'))).toBe(false);
  });

  it('selects rows with Ctrl+click without playing them and removes them on Delete', () => {
    const tracks = makeTracks(4);
    seedQueue(tracks, { index: 0, currentTrack: tracks[0] });
    const { container } = renderWithProviders(<QueuePanel />);

    fireEvent.click(rowsOf(container)[1]!, { ctrlKey: true });
    fireEvent.click(rowsOf(container)[3]!, { ctrlKey: true });

    expect(rowsOf(container).map(row => row.classList.contains('bulk-selected')))
      .toEqual([false, true, false, true]);
    expect(usePlayerStore.getState().queueIndex).toBe(0);

    act(() => { fireEvent.keyDown(document.body, { key: 'Delete', ctrlKey: true }); });

    expect(usePlayerStore.getState().queueItems.map(ref => ref.trackId))
      .toEqual([tracks[0].id, tracks[2].id]);
    expect(rowsOf(container).some(row => row.classList.contains('bulk-selected'))).toBe(false);
  });

  it('keeps the selection after Ctrl is released, so Delete still removes it', () => {
    const tracks = makeTracks(3);
    seedQueue(tracks, { index: 0, currentTrack: tracks[0] });
    const { container } = renderWithProviders(<QueuePanel />);
    fireEvent.click(rowsOf(container)[1]!, { ctrlKey: true });
    fireEvent.click(rowsOf(container)[2]!, { ctrlKey: true });

    act(() => { fireEvent.keyUp(document.body, { key: 'Control' }); });
    expect(rowsOf(container).filter(row => row.classList.contains('bulk-selected'))).toHaveLength(2);

    act(() => { fireEvent.keyDown(document.body, { key: 'Delete' }); });
    expect(usePlayerStore.getState().queueItems.map(ref => ref.trackId)).toEqual([tracks[0].id]);
  });

  it('dissolves the selection on a plain click and plays the clicked row', async () => {
    const tracks = makeTracks(4);
    seedQueue(tracks, { index: 0, currentTrack: tracks[0] });
    const { container } = renderWithProviders(<QueuePanel />);
    fireEvent.click(rowsOf(container)[1]!, { ctrlKey: true });
    fireEvent.click(rowsOf(container)[2]!, { ctrlKey: true });

    fireEvent.click(rowsOf(container)[3]!);

    expect(rowsOf(container).some(row => row.classList.contains('bulk-selected'))).toBe(false);
    await waitFor(() => expect(usePlayerStore.getState().queueIndex).toBe(3));
  });

  it('does not let the playing row join a selection', () => {
    const tracks = makeTracks(3);
    seedQueue(tracks, { index: 1, currentTrack: tracks[1] });
    const { container } = renderWithProviders(<QueuePanel />);

    fireEvent.click(rowsOf(container)[1]!, { ctrlKey: true });

    expect(rowsOf(container)[1]!.classList.contains('bulk-selected')).toBe(false);
  });
});
afterEach(() => {
  usePlayerStore.getState().closeContextMenu();
});
