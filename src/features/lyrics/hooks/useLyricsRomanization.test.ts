import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  convert: vi.fn(),
  init: vi.fn(async () => undefined),
}));

vi.mock('kuroshiro', () => ({
  default: class Kuroshiro {
    init = mocks.init;
    convert = mocks.convert;
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.convert.mockReset();
  mocks.init.mockClear();
});

describe('lyrics romanization', () => {
  it('does not load the Japanese analyzer for non-Japanese lyrics', async () => {
    const { romanizeJapaneseLines } = await import('./useLyricsRomanization');
    await expect(romanizeJapaneseLines(['纯音乐', 'hello'])).resolves.toBeNull();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('keeps line alignment and omits duplicate Latin-only lines', async () => {
    mocks.convert.mockImplementation(async (line: string) => ({
      '君の名は': 'kimi no na wa',
      hello: 'hello',
      'また明日': 'mata ashita',
    })[line] ?? line);
    const { romanizeJapaneseLines } = await import('./useLyricsRomanization');

    await expect(romanizeJapaneseLines(['君の名は', 'hello', 'また明日'])).resolves.toEqual([
      'kimi no na wa',
      '',
      'mata ashita',
    ]);
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });

  it('prefers a server pronunciation layer without loading Kuroshiro', async () => {
    const { useLyricsRomanization } = await import('./useLyricsRomanization');
    const { result } = renderHook(() => useLyricsRomanization({
      enabled: true,
      syncedLines: [
        { time: 1, text: '君の名は' },
        { time: 5, text: 'また明日' },
      ],
      wordLines: null,
      plainLyrics: null,
      pronunciationLines: [
        { time: 5, text: 'mata ashita' },
        { time: 1, text: 'kimi no na wa' },
      ],
      pronunciationPlainLyrics: null,
    }));

    expect(result.current).toEqual(['kimi no na wa', 'mata ashita']);
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('generates Japanese romaji asynchronously when the server has no layer', async () => {
    mocks.convert.mockResolvedValue('kimi no na wa');
    const { useLyricsRomanization } = await import('./useLyricsRomanization');
    const { result } = renderHook(() => useLyricsRomanization({
      enabled: true,
      syncedLines: [{ time: 1, text: '君の名は' }],
      wordLines: null,
      plainLyrics: null,
      pronunciationLines: null,
      pronunciationPlainLyrics: null,
    }));

    await waitFor(() => expect(result.current).toEqual(['kimi no na wa']));
  });
});
