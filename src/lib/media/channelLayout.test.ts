import { describe, expect, it } from 'vitest';
import { formatChannelLayout, parseChannelLayout } from './channelLayout';

describe('verified channel layout', () => {
  it.each([
    [5, 1, 6, '5.1'], [6, 0, 6, '6.0'], [3, 1, 4, '3.1'], [4, 0, 4, '4.0'],
  ])('formats only backend grouping %i+%i for %i channels', (main, lfe, channels, label) => {
    const layout = parseChannelLayout({ mainChannels: main, lfeChannels: lfe, provenance: 'flac-mask' }, channels);
    expect(layout && formatChannelLayout(layout)).toBe(label);
  });

  it.each([
    [null, 6], [{ mainChannels: 5, lfeChannels: 1, provenance: 'other' }, 6],
    [{ mainChannels: 5.5, lfeChannels: 0, provenance: 'wav-mask' }, 6],
    [{ mainChannels: 5, lfeChannels: -1, provenance: 'wav-mask' }, 4],
    [{ mainChannels: 5, lfeChannels: 2, provenance: 'wav-mask' }, 7],
    [{ mainChannels: 5, lfeChannels: 1, provenance: 'wav-mask' }, 5],
    [{ mainChannels: 11, lfeChannels: 0, provenance: 'wav-mask' }, 12],
  ])('rejects invalid, absent or count-only layouts', (layout, channels) => {
    expect(parseChannelLayout(layout, channels)).toBeUndefined();
  });
});
