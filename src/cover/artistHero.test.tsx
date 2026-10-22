import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { SubsonicArtistInfo } from '@/lib/api/subsonicTypes';
import { ArtistHeroCover } from './artistHero';
import type { CoverArtRef } from './types';

vi.mock('@/cover/CoverArtImage', () => ({
  CoverArtImage: () => <div data-testid="pipeline-cover" />,
}));

/** Loads every src on the next microtask, like a reachable image host. */
class LoadingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

const coverRef: CoverArtRef = {
  cacheKind: 'artist',
  cacheEntityId: 'ar-1',
  fetchCoverArtId: 'ar-1',
  serverScope: { kind: 'active' },
};

function info(largeImageUrl: string): SubsonicArtistInfo {
  return { largeImageUrl } as SubsonicArtistInfo;
}

async function renderHero(artistInfo: SubsonicArtistInfo, fallback: CoverArtRef | null) {
  const view = render(
    <ArtistHeroCover
      artistId="ar-1"
      artistInfo={artistInfo}
      coverFallback={fallback}
      displayCssPx={300}
      alt="Artist"
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  vi.stubGlobal('Image', LoadingImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ArtistHeroCover', () => {
  it('renders the server’s own /share/img artwork through the cover pipeline', async () => {
    const { container, queryByTestId } = await renderHero(
      info('https://music.example.test/share/img/token-abc?size=1200'),
      coverRef,
    );
    expect(queryByTestId('pipeline-cover')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps an external artist image ahead of the cover pipeline', async () => {
    const external = 'https://images.example.test/artist/large.jpg';
    const { container, queryByTestId } = await renderHero(info(external), coverRef);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(external);
    expect(queryByTestId('pipeline-cover')).toBeNull();
  });

  it('still shows the /share/img URL when there is no cover ref to fall back on', async () => {
    const url = 'https://music.example.test/share/img/token-abc?size=1200';
    const { container } = await renderHero(info(url), null);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(url);
  });
});
