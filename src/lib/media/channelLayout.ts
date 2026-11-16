export type ChannelLayoutProvenance =
  | 'vorbis-mapping'
  | 'flac-default'
  | 'flac-mask'
  | 'wav-mask';

export interface ChannelLayout {
  mainChannels: number;
  lfeChannels: number;
  provenance: ChannelLayoutProvenance;
}

const PROVENANCES: readonly ChannelLayoutProvenance[] = [
  'vorbis-mapping', 'flac-default', 'flac-mask', 'wav-mask',
];

/** Parse backend-verified speaker grouping, never deriving it from a count. */
export function parseChannelLayout(value: unknown, channels: unknown): ChannelLayout | undefined {
  if (typeof channels !== 'number' || !Number.isSafeInteger(channels) || channels < 1 || channels > 11) {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const layout = value as Record<string, unknown>;
  const { mainChannels, lfeChannels, provenance } = layout;
  if (typeof mainChannels !== 'number' || !Number.isSafeInteger(mainChannels) || mainChannels <= 0 || mainChannels > 11) {
    return undefined;
  }
  if (typeof lfeChannels !== 'number' || !Number.isSafeInteger(lfeChannels) || lfeChannels < 0 || lfeChannels > 1) {
    return undefined;
  }
  if (!PROVENANCES.includes(provenance as ChannelLayoutProvenance)) return undefined;
  if (mainChannels + lfeChannels !== channels) return undefined;
  return { mainChannels, lfeChannels, provenance: provenance as ChannelLayoutProvenance };
}

export function formatChannelLayout(layout: ChannelLayout): string {
  return `${layout.mainChannels}.${layout.lfeChannels}`;
}
