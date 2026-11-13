import { describe, expect, it, vi } from 'vitest';
import { nextCatalogSearchPage, type CatalogSearchSource } from './catalogSearch';
import { makeSubsonicSong } from '@/test/helpers/factories';

const page = (serverId: string, ids: string[], consumed = ids.length) => ({
  artists: [], albums: [], songs: ids.map(id => makeSubsonicSong({ id, serverId })), consumed,
});
const source = (run: CatalogSearchSource['run']): CatalogSearchSource => ({ run, offset: 0, hasMore: true });

describe('catalog search provider paging', () => {
  it('queries providers in parallel and keeps identical IDs from different owners', async () => {
    const sources = [source(vi.fn(async () => page('octo', ['same', 'external']))), source(vi.fn(async () => page('local', ['same'])))];
    const first = await nextCatalogSearchPage(sources, 2);
    expect(first.results.songs.map(song => [song.serverId, song.id])).toEqual([
      ['octo', 'same'], ['octo', 'external'], ['local', 'same'],
    ]);
    expect(first.hasMore).toBe(true);
    await nextCatalogSearchPage(sources, 2);
    expect(sources[0].run).toHaveBeenLastCalledWith(2, 2);
    expect(sources[1].run).toHaveBeenCalledTimes(1);
  });
  it('deduplicates per owner without using the merged count as a cursor', async () => {
    const sources = [source(async () => page('octo', ['same'], 2)), source(async () => page('octo', ['same'], 3))];
    const result = await nextCatalogSearchPage(sources, 2);
    expect(result.results.songs).toHaveLength(1);
    expect(sources.map(provider => provider.offset)).toEqual([2, 3]);
  });
  it('keeps local results and the retry cursor when an external provider is unavailable', async () => {
    const sources = [source(async () => { throw new Error('offline'); }), source(async () => page('local', ['cached']))];
    const result = await nextCatalogSearchPage(sources, 2);
    expect(result.results.songs[0].id).toBe('cached');
    expect(sources[0].offset).toBe(0);
    expect(sources[0].hasMore).toBe(true);
  });
  it('reports failure if no provider can answer', async () => {
    await expect(nextCatalogSearchPage([source(async () => null)], 2)).rejects.toThrow();
  });
});
