import { describe, expect, it } from 'vitest';
import {
  DEFAULT_80_MIN_SECTORS,
  MAX_TRACKS,
  MIN_TRACK_SECTORS,
  PREGAP_SECTORS,
  RED_BOOK_74_MIN_SECTORS,
  describeBlocker,
  formatDuration,
  formatMsf,
  layoutDisc,
  sectorsToSeconds,
  secondsToSectors,
  tracksNeedingDownload,
  estimatedDownloadBytes,
  formatBytes,
  type BurnQueueTrack,
} from './capacity';

function track(title: string, durationSec: number, localPath: string | null = '/music/x.flac'): BurnQueueTrack {
  return {
    key: `srv:${title}`,
    serverId: 'srv',
    trackId: title,
    title,
    artist: 'Test Artist',
    album: 'Test Album',
    durationSec,
    localPath,
  };
}

describe('sector arithmetic', () => {
  it('rounds partial sectors up so a fragment is still reserved', () => {
    expect(secondsToSectors(1)).toBe(75);
    expect(secondsToSectors(1.001)).toBe(76);
    expect(secondsToSectors(0)).toBe(0);
    expect(secondsToSectors(-5)).toBe(0);
    expect(secondsToSectors(Number.NaN)).toBe(0);
  });

  it('round-trips whole seconds', () => {
    expect(sectorsToSeconds(secondsToSectors(180))).toBe(180);
  });
});

describe('MSF formatting', () => {
  it('matches the sector clock', () => {
    expect(formatMsf(0)).toBe('00:00:00');
    expect(formatMsf(74)).toBe('00:00:74');
    expect(formatMsf(PREGAP_SECTORS)).toBe('00:02:00');
    expect(formatMsf(RED_BOOK_74_MIN_SECTORS)).toBe('74:00:00');
  });

  it('never renders a negative position', () => {
    expect(formatMsf(-500)).toBe('00:00:00');
  });
});

describe('formatDuration', () => {
  it('pads seconds but not minutes', () => {
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(4528)).toBe('75:28');
  });
});

describe('layoutDisc', () => {
  it('places the first track after the pregap', () => {
    const layout = layoutDisc([track('a', 60)]);
    expect(layout.arcs[0].startSector).toBe(PREGAP_SECTORS);
    expect(layout.arcs[0].number).toBe(1);
  });

  it('lays tracks end to end', () => {
    const layout = layoutDisc([track('a', 60), track('b', 30), track('c', 90)]);
    expect(layout.arcs[1].startSector).toBe(PREGAP_SECTORS + 60 * 75);
    expect(layout.arcs[2].startSector).toBe(PREGAP_SECTORS + 90 * 75);
    expect(layout.totalSectors).toBe(PREGAP_SECTORS + 180 * 75);
  });

  it('maps the whole disc onto 360 degrees', () => {
    const layout = layoutDisc([track('full', sectorsToSeconds(DEFAULT_80_MIN_SECTORS - PREGAP_SECTORS))]);
    expect(layout.arcs[0].startAngle).toBeCloseTo((PREGAP_SECTORS / DEFAULT_80_MIN_SECTORS) * 360, 5);
    expect(layout.arcs[0].endAngle).toBeCloseTo(360, 5);
  });

  it('clamps an overflowing arc to the rim instead of winding past it', () => {
    const layout = layoutDisc([track('too-long', 6000)]);
    expect(layout.arcs[0].endAngle).toBeLessThanOrEqual(360);
    expect(layout.fits).toBe(false);
  });

  it('puts the 74-minute mark where the disc capacity says it belongs', () => {
    const layout = layoutDisc([track('a', 60)]);
    expect(layout.redBook74Angle).toBeCloseTo((RED_BOOK_74_MIN_SECTORS / DEFAULT_80_MIN_SECTORS) * 360, 5);
  });

  it('flags crossing 74 minutes while still fitting an 80-minute blank', () => {
    const layout = layoutDisc([track('long', 4500)]);
    expect(layout.fits).toBe(true);
    expect(layout.pastRedBook74).toBe(true);
  });

  it('pads a very short track to the four-second floor', () => {
    const layout = layoutDisc([track('blip', 1.2)]);
    expect(layout.arcs[0].sectors).toBe(MIN_TRACK_SECTORS);
  });

  it('reports remaining capacity and never goes negative', () => {
    const layout = layoutDisc([track('a', 60)]);
    expect(layout.remainingSectors).toBe(DEFAULT_80_MIN_SECTORS - PREGAP_SECTORS - 60 * 75);

    const over = layoutDisc([track('a', 6000)]);
    expect(over.remainingSectors).toBe(0);
  });

  it('uses the probed capacity when the disc reports one', () => {
    const layout = layoutDisc([track('a', 60)], RED_BOOK_74_MIN_SECTORS);
    expect(layout.capacitySectors).toBe(RED_BOOK_74_MIN_SECTORS);
    expect(layout.redBook74Angle).toBeCloseTo(360, 5);
  });

  it('falls back to an 80-minute blank when capacity is unknown', () => {
    expect(layoutDisc([track('a', 60)], 0).capacitySectors).toBe(DEFAULT_80_MIN_SECTORS);
  });

  it('does not consider an empty queue burnable', () => {
    const layout = layoutDisc([]);
    expect(layout.fits).toBe(false);
    expect(layout.totalSectors).toBe(PREGAP_SECTORS);
  });
});

describe('describeBlocker', () => {
  it('reports an empty queue', () => {
    expect(describeBlocker(layoutDisc([]), 0)?.key).toBe('burner.blockerEmpty');
  });

  it('reports going over capacity with the overage', () => {
    const tracks = [track('a', 6000)];
    const blocker = describeBlocker(layoutDisc(tracks), tracks.length);
    expect(blocker?.key).toBe('burner.blockerOverCapacity');
    expect(blocker?.values?.over).toBeTruthy();
  });

  it('reports the 99-track ceiling', () => {
    const tracks = Array.from({ length: 100 }, (_, i) => track(`t${i}`, 10));
    const blocker = describeBlocker(layoutDisc(tracks), tracks.length);
    expect(blocker?.key).toBe('burner.blockerTooManyTracks');
    expect(blocker?.values?.max).toBe(MAX_TRACKS);
  });

  it('returns null for a queue that fits', () => {
    const tracks = [track('a', 60), track('b', 120)];
    expect(describeBlocker(layoutDisc(tracks), tracks.length)).toBeNull();
  });
});

describe('tracksNeedingDownload', () => {
  it('finds tracks that resolved to no local file', () => {
    const remote = track('gone', 60, null);
    const result = tracksNeedingDownload([track('here', 60), remote]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('gone');
  });

  it('treats an unresolved path as still-unknown rather than remote', () => {
    const pending = { ...track('pending', 60), localPath: undefined };
    expect(tracksNeedingDownload([pending])).toHaveLength(0);
  });
});

describe('estimatedDownloadBytes', () => {
  it('counts only the tracks that are not cached', () => {
    const cached = { ...track('cached', 60), sizeBytes: 9_000_000 };
    const remote = { ...track('remote', 60, null), sizeBytes: 5_000_000 };
    expect(estimatedDownloadBytes([cached, remote])).toBe(5_000_000);
  });

  it('falls back to the duration when the server reports no size', () => {
    const remote = track('remote', 60, null);
    // 60 s at the assumed 125 kB/s.
    expect(estimatedDownloadBytes([remote])).toBe(60 * 125_000);
  });

  it('is zero when everything is already cached', () => {
    expect(estimatedDownloadBytes([track('a', 60), track('b', 60)])).toBe(0);
  });
});

describe('formatBytes', () => {
  it('scales into readable units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });

  it('never renders a negative size', () => {
    expect(formatBytes(-10)).toBe('0 B');
  });
});
