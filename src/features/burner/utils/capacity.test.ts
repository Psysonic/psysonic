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

  it('fills the disc exactly when the queue is exactly disc-sized', () => {
    const layout = layoutDisc([track('full', sectorsToSeconds(DEFAULT_80_MIN_SECTORS - PREGAP_SECTORS))]);
    expect(layout.totalSectors).toBe(DEFAULT_80_MIN_SECTORS);
    expect(layout.remainingSectors).toBe(0);
    expect(layout.fits).toBe(true);
  });

  it('refuses a queue that runs past the rim rather than clamping it quietly', () => {
    const layout = layoutDisc([track('too-long', 6000)]);
    expect(layout.totalSectors).toBeGreaterThan(layout.capacitySectors);
    expect(layout.fits).toBe(false);
  });

  it('leaves a queue inside 74 minutes unflagged', () => {
    expect(layoutDisc([track('a', 60)]).pastRedBook74).toBe(false);
  });

  it('flags crossing 74 minutes while still fitting an 80-minute blank', () => {
    const layout = layoutDisc([track('long', 4500)]);
    expect(layout.fits).toBe(true);
    expect(layout.pastRedBook74).toBe(true);
  });

  it('charges a gapped disc two seconds before every track after the first', () => {
    // The mirror of plan_disc in the Rust crate. If this arithmetic left the
    // pauses out, the ring would promise a fit the drive refuses at SEND CUE
    // SHEET — after every track had already been fetched and rendered.
    const queue = [track('a', 60), track('b', 60), track('c', 60)];
    const gapless = layoutDisc(queue, DEFAULT_80_MIN_SECTORS, true);
    const gapped = layoutDisc(queue, DEFAULT_80_MIN_SECTORS, false);
    expect(gapped.totalSectors - gapless.totalSectors).toBe(2 * PREGAP_SECTORS);
    expect(gapped.arcs[0].startSector).toBe(gapless.arcs[0].startSector);
    expect(gapped.arcs[1].startSector - gapless.arcs[1].startSector).toBe(PREGAP_SECTORS);
    expect(gapped.arcs[2].startSector - gapless.arcs[2].startSector).toBe(2 * PREGAP_SECTORS);
  });

  it('lays one track out identically either way', () => {
    const one = [track('only', 60)];
    expect(layoutDisc(one, DEFAULT_80_MIN_SECTORS, false).totalSectors)
      .toBe(layoutDisc(one, DEFAULT_80_MIN_SECTORS, true).totalSectors);
  });

  it('refuses a queue that only fits without the gaps', () => {
    // 4795 seconds of audio is 359,625 sectors: inside an 80-minute blank's
    // 359,699-sector program area, but not once the one pause between the two
    // tracks takes another 150. This is the case the arithmetic exists for.
    const queue = [track('a', 2397), track('b', 2398)];
    expect(layoutDisc(queue, DEFAULT_80_MIN_SECTORS, true).fits).toBe(true);
    expect(layoutDisc(queue, DEFAULT_80_MIN_SECTORS, false).fits).toBe(false);
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
  });

  it('falls back to an 80-minute blank when capacity is unknown', () => {
    expect(layoutDisc([track('a', 60)], 0).capacitySectors).toBe(DEFAULT_80_MIN_SECTORS);
  });

  it('does not consider an empty queue burnable', () => {
    const layout = layoutDisc([]);
    expect(layout.fits).toBe(false);
    expect(layout.totalSectors).toBe(PREGAP_SECTORS);
  });

  it('does not consider a hundred tracks burnable however short they are', () => {
    // Red Book allows 99 per session. A hundred four-second tracks are seven
    // minutes of an eighty-minute blank, so the sector arithmetic has nothing
    // to object to — the ceiling is the only thing between this queue and a
    // drive that refuses the cue sheet after every track has been rendered.
    const queue = Array.from({ length: MAX_TRACKS + 1 }, (_, i) => track(`t${i}`, 4));
    const layout = layoutDisc(queue);
    expect(layout.totalSectors).toBeLessThan(layout.capacitySectors);
    expect(layout.fits).toBe(false);
    // Ninety-nine of the very same tracks do fit, so this is the Red Book
    // ceiling rather than a refusal of long queues.
    expect(layoutDisc(queue.slice(0, MAX_TRACKS)).fits).toBe(true);
  });
});

describe('describeBlocker', () => {
  it('reports an empty queue', () => {
    expect(describeBlocker(layoutDisc([]), 0)?.key).toBe('burner.blockerEmpty');
  });

  it('reports going over capacity with the overage', () => {
    // 6000 seconds is 450,000 sectors, and the pregap makes the queue 450,150
    // against an 80-minute blank's 359,849 — 90,301 sectors, 20:04 of audio
    // that has to go. Spelled out, because merely asking for a non-empty
    // string is satisfied by '0:00' and by a negative overage alike, and both
    // of those are the arithmetic having got the subtraction backwards.
    const tracks = [track('a', 6000)];
    const blocker = describeBlocker(layoutDisc(tracks), tracks.length);
    expect(blocker?.key).toBe('burner.blockerOverCapacity');
    expect(blocker?.values?.over).toBe('20:04');
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
