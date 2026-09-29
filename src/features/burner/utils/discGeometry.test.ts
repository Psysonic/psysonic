import { describe, expect, it } from 'vitest';
import {
  annularSector, capacityAngle, discGeometry, polar, programAreaSectors, sliceAtAngle,
  tracksBefore, wedgeEnd,
} from './discGeometry';
import {
  DEFAULT_80_MIN_SECTORS, PREGAP_SECTORS, layoutDisc, type BurnQueueTrack, type DiscArc,
} from './capacity';

const color = (i: number) => `#00000${i}`;

function arc(number: number, sectors: number): DiscArc {
  return {
    key: `k${number}`,
    serverId: 'srv',
    trackId: String(number),
    title: `T${number}`,
    artist: 'A',
    album: 'Al',
    durationSec: sectors / 75,
    number,
    startSector: 0,
    sectors,
  };
}

/** Four ten-minute tracks — 40 minutes, well short of an 80-minute disc. */
const QUEUE = [1, 2, 3, 4].map(n => arc(n, 10 * 60 * 75));

/**
 * A queue track, for laying a disc out with the real `layoutDisc`.
 *
 * The arcs above are hand-built and so already sit in whatever space the test
 * chooses. Crossing between the two sector spaces can only be tested against a
 * layout the page would actually produce.
 */
function queued(title: string, durationSec: number): BurnQueueTrack {
  return {
    key: `srv:${title}`,
    serverId: 'srv',
    trackId: title,
    title,
    artist: 'A',
    album: 'Al',
    durationSec,
    localPath: '/music/x.flac',
  };
}

describe('discGeometry', () => {
  const g = discGeometry(QUEUE, color, { sectorsDone: 0 });

  it('fills the circle however short the queue is', () => {
    // 40 minutes of music does not half-fill the ring: the empty remainder
    // read as a fault rather than as headroom.
    expect(g.slices[g.slices.length - 1].endAngle).toBeCloseTo(360, 1);
  });

  it('gives equal-length tracks equal wedges', () => {
    const widths = g.slices.map(s => s.endAngle - s.startAngle);
    for (const w of widths) expect(w).toBeCloseTo(widths[0], 1);
  });

  it('starts the first track at the sector the drive counts from', () => {
    // The scale is the program area, counted from zero, because that is the
    // only space every backend reports `sectorsDone` in. It used to include
    // the 150-sector pregap to match the disc-absolute `arc.startSector`, and
    // then disagreed with the drive by exactly 150 for the whole burn.
    expect(g.slices[0].startAngle).toBe(0);
    expect(g.slices[0].startSector).toBe(0);
  });

  it('walks startSector in the same space the drive reports', () => {
    let cursor = 0;
    for (const slice of g.slices) {
      expect(slice.startSector).toBe(cursor);
      cursor += slice.sectors;
    }
    expect(cursor).toBe(g.scaleSectors);
  });

  it('reads half written as half a turn', () => {
    const mid = discGeometry(QUEUE, color, { sectorsDone: Math.round(g.scaleSectors / 2) });
    expect(mid.progressAngle).toBeCloseTo(180, 1);
  });

  it('shows no progress before anything is written', () => {
    expect(g.progressAngle).toBe(0);
  });

  it('never runs past a full turn when the drive overshoots', () => {
    expect(discGeometry(QUEUE, color, { sectorsDone: 999_999 }).progressAngle).toBe(360);
  });

  it('an empty queue produces no slices and no progress', () => {
    const empty = discGeometry([], color, { sectorsDone: 0 });
    expect(empty.slices).toHaveLength(0);
    expect(empty.progressAngle).toBe(0);
  });

  it('gives a longer track a proportionally wider wedge', () => {
    const mixed = discGeometry(
      [arc(1, 60 * 75), arc(2, 180 * 75)],
      color,
      { sectorsDone: 0 },
    );
    const first = mixed.slices[0].endAngle - mixed.slices[0].startAngle;
    const second = mixed.slices[1].endAngle - mixed.slices[1].startAngle;
    expect(second / first).toBeCloseTo(3, 1);
  });
});

describe('programAreaSectors', () => {
  /** Three ten-minute tracks, laid out the way the page lays them out. */
  const layout = layoutDisc([queued('a', 600), queued('b', 600), queued('c', 600)]);

  it('takes the pregap off, and takes it off rather than adding it', () => {
    // `layoutDisc` counts from the front of the disc; everything in
    // `discGeometry` counts from zero. One pregap is the entire difference,
    // and its direction is the whole point: added instead of subtracted, the
    // answer is 300 sectors out and still looks like a sensible number.
    expect(programAreaSectors(layout)).toBe(layout.totalSectors - PREGAP_SECTORS);
    expect(programAreaSectors(layout)).toBeLessThan(layout.totalSectors);
  });

  it('lands exactly on the scale the ring is drawn to', () => {
    // The invariant this function exists for. Whatever it hands
    // `capacityAngle` has to be the same number `discGeometry` sizes the
    // circle by, or the marker is measured against one ring and drawn on
    // another — and nothing on the page would look wrong.
    const geometry = discGeometry(layout.arcs, color, { sectorsDone: 0 });
    expect(programAreaSectors(layout)).toBe(geometry.scaleSectors);
  });

  it('reads an empty queue as no program area at all', () => {
    // An empty layout is the pregap and nothing else.
    expect(programAreaSectors(layoutDisc([]))).toBe(0);
  });

  it('marks capacity where the converted queue puts it', () => {
    // Composed the way `BurnDisc` composes them, so a call site that dropped
    // the conversion or reversed it moves the marker here too.
    const over = layoutDisc([queued('long', 5400)]);
    const room = DEFAULT_80_MIN_SECTORS - PREGAP_SECTORS;
    expect(capacityAngle(programAreaSectors(over), over.capacitySectors))
      .toBeCloseTo((360 * room) / (over.totalSectors - PREGAP_SECTORS), 6);
  });
});

describe('capacityAngle', () => {
  /** The disc's own program area, once its mandatory pregap is spent. */
  const ROOM = DEFAULT_80_MIN_SECTORS - PREGAP_SECTORS;

  it('marks nothing while the queue fits', () => {
    expect(capacityAngle(ROOM - 60 * 75, DEFAULT_80_MIN_SECTORS)).toBeNull();
  });

  it('marks nothing when the queue lands exactly on the disc edge', () => {
    // The edge is where the queue ends, so there is no past-it to wash.
    expect(capacityAngle(ROOM, DEFAULT_80_MIN_SECTORS)).toBeNull();
  });

  it('marks nothing on an empty queue', () => {
    expect(capacityAngle(0, DEFAULT_80_MIN_SECTORS)).toBeNull();
  });

  it('marks nothing when the capacity is smaller than the pregap', () => {
    expect(capacityAngle(10_000, PREGAP_SECTORS)).toBeNull();
  });

  it('puts a tenth-over queue where the last tenth of the ring begins', () => {
    expect(capacityAngle(Math.round(ROOM * 1.1), DEFAULT_80_MIN_SECTORS))
      .toBeCloseTo(360 / 1.1, 2);
  });

  it('keeps a hair of ring for a queue one sector over', () => {
    // Rounded to a full turn the wash behind the marker would be zero degrees
    // wide and draw as nothing, so the closest call of all would show nothing.
    expect(capacityAngle(ROOM + 1, DEFAULT_80_MIN_SECTORS)).toBe(359.99);
  });

  it('works in program-area space, so the pregap moves the marker visibly', () => {
    // The file's header records what happened last time these two spaces were
    // mixed. On a queue this size the pregap is worth more than a tenth of a
    // degree, which is enough to put the marker on the wrong side of a wedge
    // boundary and tell someone the wrong track has to go.
    const queue = 396_000;
    const marked = capacityAngle(queue, DEFAULT_80_MIN_SECTORS);
    const ignoringPregap = (360 * DEFAULT_80_MIN_SECTORS) / queue;
    expect(marked).toBeCloseTo((360 * ROOM) / queue, 6);
    expect(Math.abs(ignoringPregap - (marked ?? 0))).toBeGreaterThan(0.1);
  });
});

describe('sliceAtAngle', () => {
  const g = discGeometry(QUEUE, color, { sectorsDone: 0 });

  it('finds the track under the head', () => {
    expect(sliceAtAngle(g.slices, 100)?.index).toBe(1);
  });

  it('reports nothing before the first sector', () => {
    expect(sliceAtAngle(g.slices, 0)).toBeNull();
  });

  it('uses the drawn angles, so it cannot disagree with the ring', () => {
    const second = g.slices[1];
    expect(sliceAtAngle(g.slices, second.startAngle)?.index).toBe(1);
    // The boundary belongs to the track that starts there, not the one ending.
    expect(sliceAtAngle(g.slices, second.endAngle)?.index).toBe(2);
  });
});

describe('tracksBefore', () => {
  const g = discGeometry(QUEUE, color, { sectorsDone: 0 });

  it('counts nothing before the laser has moved', () => {
    expect(tracksBefore(g.slices, 0)).toBe(0);
  });

  it('counts a track only once it is wholly behind the head', () => {
    const first = g.slices[0];
    expect(tracksBefore(g.slices, first.sectors - 1)).toBe(0);
    expect(tracksBefore(g.slices, first.sectors)).toBe(1);
  });

  it('reaches every track when the drive reports the queue complete', () => {
    // The count is taken in the drive's space, so a finished burn marks the
    // last track too. With the pregap in the scale it never could.
    expect(tracksBefore(g.slices, g.scaleSectors)).toBe(QUEUE.length);
  });
});

describe('wedgeEnd', () => {
  it('cuts a hairline off the end of a wedge', () => {
    expect(wedgeEnd({ startAngle: 0, endAngle: 90 })).toBeCloseTo(90 - 0.34, 6);
  });

  it('never lets the gap swallow a short track whole', () => {
    // A four-second track on an eighty-minute queue is a fifth of a degree; a
    // flat hairline would leave nothing of it but gap.
    expect(wedgeEnd({ startAngle: 0, endAngle: 0.2 })).toBeCloseTo(0.15, 6);
  });
});

describe('polar', () => {
  it('puts zero degrees at twelve o clock', () => {
    const [x, y] = polar(10, 0);
    expect(x).toBeCloseTo(50, 6);
    expect(y).toBeCloseTo(40, 6);
  });

  it('runs clockwise, so ninety degrees is three o clock', () => {
    const [x, y] = polar(10, 90);
    expect(x).toBeCloseTo(60, 6);
    expect(y).toBeCloseTo(50, 6);
  });
});

describe('annularSector', () => {
  it('draws out along the rim and back along the hub', () => {
    const d = annularSector(20, 40, 0, 90);
    expect(d).toMatch(/^M50\.000 10\.000A40 40 0 0 1 90\.000 50\.000L70\.000 50\.000A20 20 0 0 0 50\.000 30\.000Z$/);
  });

  it('sets the large-arc flag once past a half turn', () => {
    expect(annularSector(20, 40, 0, 181)).toContain('A40 40 0 1 1');
    expect(annularSector(20, 40, 0, 179)).toContain('A40 40 0 0 1');
  });

  it('gives a vanishingly short track a floor, so it is drawn at all', () => {
    // Zero-width sectors render as nothing; a four-second track between two
    // long ones would simply be missing from the ring.
    expect(annularSector(20, 40, 10, 10)).toBe(annularSector(20, 40, 10, 10.02));
  });

  it('leaves a wedge already wider than the floor at its own width', () => {
    // The floor is a minimum, not the width every short track is given: a
    // wedge that widens to 0.02deg whatever its real span would make the ring
    // stop being a picture of the running order.
    expect(annularSector(20, 40, 10, 10.5)).not.toBe(annularSector(20, 40, 10, 10.02));
  });
});
