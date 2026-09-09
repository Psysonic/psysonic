import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import type { SubsonicAlbum } from '@/lib/api/subsonicTypes';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { latestResizeObserver } from '@/test/mocks/browser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { artistInfoMock, artistMock, readCacheMock, writeCacheMock, primeMock } = vi.hoisted(() => ({
  artistInfoMock: vi.fn(),
  artistMock: vi.fn(),
  readCacheMock: vi.fn(),
  writeCacheMock: vi.fn(),
  primeMock: vi.fn(),
}));

vi.mock('@/lib/api/subsonicArtists', () => ({
  getArtistInfoForServer: artistInfoMock,
  getArtistForServer: artistMock,
}));
vi.mock('@/features/home/store/becauseYouLikeCache', () => ({
  readBecauseYouLikeCache: readCacheMock,
  writeBecauseYouLikeCache: writeCacheMock,
}));
vi.mock('@/cover/warmDiskPeek', () => ({ primeAlbumCoversForDisplay: primeMock }));
vi.mock('@/cover/useLibraryCoverPrefetch', () => ({ useLibraryCoverPrefetch: vi.fn() }));
vi.mock('@/cover/useLibraryCoverRef', () => ({ useAlbumCoverRef: () => null }));
vi.mock('@/cover/useCoverArt', () => ({
  useCoverArt: () => ({ src: '', onImgError: vi.fn() }),
}));
vi.mock('@/lib/util/shuffleArray', () => ({ shuffleArray: <T,>(items: T[]) => items }));
vi.mock('@/features/album', () => ({
  AlbumRow: ({ albums }: { albums: SubsonicAlbum[] }) => <div data-testid="albums">{albums.length}</div>,
  albumArtistDisplayName: (item: SubsonicAlbum) => item.artist,
  useNavigateToAlbum: () => vi.fn(),
}));

import BecauseYouLikeRail, { buildAnchorPool } from '@/features/home/components/BecauseYouLikeRail';

function album(serverId: string | undefined, artistId: string, name: string): SubsonicAlbum {
  return {
    id: `${serverId ?? 'missing'}-${artistId}`,
    name: `${name} Album`,
    artist: name,
    artistId,
    songCount: 1,
    duration: 1,
    serverId,
  };
}

describe('buildAnchorPool', () => {
  it('keeps same-id artists from different owners and skips ownerless seeds', () => {
    const pool = buildAnchorPool([
      [album('srv-a', 'artist-1', 'Artist A'), album(undefined, 'artist-2', 'Ownerless')],
      [album('srv-b', 'artist-1', 'Artist B'), album('srv-a', 'artist-1', 'Duplicate')],
    ], 20);

    expect(pool).toEqual([
      { id: 'artist-1', name: 'Artist A', serverId: 'srv-a' },
      { id: 'artist-1', name: 'Artist B', serverId: 'srv-b' },
    ]);
  });
});

describe('BecauseYouLikeRail diagnostics', () => {
  beforeEach(() => {
    artistInfoMock.mockReset();
    artistMock.mockReset();
    readCacheMock.mockReset();
    writeCacheMock.mockReset();
    primeMock.mockReset();
    readCacheMock.mockReturnValue(null);
    primeMock.mockResolvedValue(undefined);
  });

  it('reports cached content immediately and keeps background reserve completion silent', async () => {
    const cachedAlbum = album('srv-a', 'cached-artist', 'Cached');
    readCacheMock.mockReturnValue({
      scopeKey: 'scope',
      scopeVersion: 1,
      anchor: { id: 'cached-artist', name: 'Cached', serverId: 'srv-a' },
      recs: [cachedAlbum],
    });
    let finishReserve!: (value: { similarArtist: never[] }) => void;
    artistInfoMock.mockReturnValue(new Promise(resolve => { finishReserve = resolve; }));
    const onDiagnosticResult = vi.fn();

    renderWithProviders(
      <BecauseYouLikeRail
        mostPlayed={[album('srv-a', 'seed', 'Seed')]}
        scopeKey="scope"
        scopeVersion={1}
        scopes={[{ serverId: 'srv-a', libraryId: 'lib-a' }]}
        onDiagnosticResult={onDiagnosticResult}
      />,
    );

    await waitFor(() => expect(onDiagnosticResult).toHaveBeenCalledTimes(2));
    expect(onDiagnosticResult.mock.calls[0][0]).toMatchObject({
      status: 'loading',
      detail: 'generation 1: pool 1',
    });
    expect(onDiagnosticResult.mock.calls[1][0]).toMatchObject({
      status: 'ready',
      itemCount: 1,
      detail: 'generation 1: cache',
    });
    expect(onDiagnosticResult.mock.calls[1][0].durationMs).toBeTypeOf('number');

    finishReserve({ similarArtist: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(onDiagnosticResult).toHaveBeenCalledTimes(2);
  });

  it('reports network generation errors with elapsed time', async () => {
    artistInfoMock.mockRejectedValue(new Error('offline'));
    const onDiagnosticResult = vi.fn();

    renderWithProviders(
      <BecauseYouLikeRail
        mostPlayed={[album('srv-a', 'seed', 'Seed')]}
        scopeKey="scope"
        scopeVersion={2}
        scopes={[{ serverId: 'srv-a', libraryId: 'lib-a' }]}
        onDiagnosticResult={onDiagnosticResult}
      />,
    );

    await waitFor(() => expect(onDiagnosticResult).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'error',
      itemCount: 0,
      detail: 'generation 1: network',
      durationMs: expect.any(Number),
    })));
  });

  it('requests recommendation albums from the anchor server browse scope', async () => {
    artistInfoMock.mockResolvedValue({
      similarArtist: [{ id: 'similar', name: 'Similar', serverId: 'srv-a' }],
    });
    artistMock.mockResolvedValue({
      artist: { id: 'similar', name: 'Similar', serverId: 'srv-a' },
      albums: [album('srv-a', 'similar', 'Similar')],
    });

    renderWithProviders(
      <BecauseYouLikeRail
        mostPlayed={[album('srv-a', 'seed', 'Seed')]}
        scopeKey="scope-scoped"
        scopeVersion={3}
        scopes={[{ serverId: 'srv-a', libraryId: 'lib-a' }]}
      />,
    );

    await waitFor(() => expect(artistMock).toHaveBeenCalledWith(
      'srv-a',
      'similar',
      { libraryIds: ['lib-a'] },
    ));
  });
});

describe('BecauseYouLikeRail narrow swap', () => {
  beforeEach(() => {
    artistInfoMock.mockReset();
    artistMock.mockReset();
    readCacheMock.mockReset();
    writeCacheMock.mockReset();
    primeMock.mockReset();
    readCacheMock.mockReturnValue(null);
    primeMock.mockResolvedValue(undefined);
    // Keep the rail in its loading state for the whole test.
    artistInfoMock.mockReturnValue(new Promise(() => {}));
  });

  function renderRail() {
    return renderWithProviders(
      <BecauseYouLikeRail
        mostPlayed={[album('srv-a', 'seed', 'Seed')]}
        scopeKey="scope-narrow"
        scopeVersion={9}
        scopes={[{ serverId: 'srv-a', libraryId: 'lib-a' }]}
      />,
    );
  }

  /** Drive the observer the rail installs on its own wrapper. */
  function reportWidth(width: number) {
    const observer = latestResizeObserver();
    if (!observer) throw new Error('rail did not observe its container');
    act(() => {
      observer.callback(
        [{ contentRect: { width } } as unknown as ResizeObserverEntry],
        observer as unknown as ResizeObserver,
      );
    });
  }

  it('keeps the wide-card skeleton out of a narrow container', () => {
    // jsdom reports a zero-width box, which is below the swap width.
    const { container } = renderRail();
    expect(container.querySelectorAll('.because-card').length).toBe(0);
  });

  it('shows the skeleton again once the container is wide enough', () => {
    const { container } = renderRail();
    reportWidth(900);
    expect(container.querySelectorAll('.because-card').length).toBeGreaterThan(0);
  });
});

describe('because-card container queries', () => {
  const css = readFileSync(
    join(process.cwd(), 'src/styles/components/orbit-session-top-strip.css'),
    'utf8',
  );

  it('drops the third card with no lower container bound', () => {
    // A lower bound leaves a band where the container is already too narrow for
    // two cards while the JS swap to the compact row has not kicked in yet, and
    // three cards then squeeze around their fixed-width cover.
    const rules = [...css.matchAll(/@container \(([^)]*)\)([^{]*)\{/g)].map(m => m[0]);
    const cardRules = rules.filter(rule => rule.includes('1051'));
    expect(cardRules.length).toBeGreaterThan(0);
    for (const rule of cardRules) expect(rule).not.toContain('min-width');
  });
});
