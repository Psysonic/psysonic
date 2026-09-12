import { describe, expect, it } from 'vitest';
import {
  buildTrackListing,
  creditLine,
  formatListingAsText,
  listingFileName,
} from './trackListing';
import type { DiscArc } from './capacity';

function arc(number: number, artist: string, title: string, durationSec: number): DiscArc {
  return {
    key: `srv:${number}`,
    serverId: 'srv',
    trackId: String(number),
    title,
    artist,
    album: 'Album',
    durationSec,
    number,
    startSector: 150 + (number - 1) * 100,
    sectors: Math.ceil(durationSec * 75),
  };
}

describe('creditLine', () => {
  it('joins artist and title', () => {
    expect(creditLine('Beastie Boys', 'Sabotage')).toBe('Beastie Boys — Sabotage');
  });

  it('drops the separator when nothing is attributed', () => {
    expect(creditLine('   ', 'Untitled')).toBe('Untitled');
  });
});

describe('buildTrackListing', () => {
  it('carries the running order, its durations and its total', () => {
    const listing = buildTrackListing(
      [arc(1, 'A', 'One', 60), arc(2, 'B', 'Two', 90)],
      '  Kewl Mix  ',
    );

    expect(listing.discTitle).toBe('Kewl Mix');
    expect(listing.trackCount).toBe(2);
    expect(listing.totalDuration).toBe('2:30');
    expect(listing.lines.map(l => l.number)).toEqual([1, 2]);
    expect(listing.lines[1].duration).toBe('1:30');
  });

  it('reports where each track starts on the disc', () => {
    const listing = buildTrackListing([arc(1, 'A', 'One', 60)], 'Mix');
    // 150 sectors of pregap is two seconds in.
    expect(listing.lines[0].startsAt).toBe('0:02');
  });
});

describe('formatListingAsText', () => {
  const burnedOn = new Date('2026-09-09T12:00:00Z');

  it('numbers every track and closes with the total', () => {
    const listing = buildTrackListing(
      [arc(1, 'Beastie Boys', 'Sabotage', 178), arc(2, 'Beastie Boys', 'Intergalactic', 231)],
      'Kewl Mix',
    );
    const text = formatListingAsText(listing, burnedOn);

    expect(text).toContain('Kewl Mix');
    expect(text).toContain('1.  Beastie Boys — Sabotage');
    expect(text).toContain('2.  Beastie Boys — Intergalactic');
    expect(text).toContain('Total  6:49');
  });

  it('aligns the duration column against this listing, not a fixed width', () => {
    const listing = buildTrackListing(
      [arc(1, 'A', 'Short', 60), arc(2, 'A', 'A Very Much Longer Title Indeed', 60)],
      'Mix',
    );
    const [first, second] = formatListingAsText(listing, burnedOn)
      .split('\n')
      .filter(line => /^\s*\d+\./.test(line));

    expect(first).toHaveLength(second.length);
  });

  it('pads the track number so a two-digit disc stays in column', () => {
    const arcs = Array.from({ length: 12 }, (_, i) => arc(i + 1, 'A', `T${i + 1}`, 60));
    const lines = formatListingAsText(buildTrackListing(arcs, 'Mix'), burnedOn)
      .split('\n')
      .filter(line => /^\s*\d+\./.test(line));

    expect(lines[0]).toMatch(/^ 1\./);
    expect(lines[11]).toMatch(/^12\./);
  });

  it('says "track" for a disc of one', () => {
    const text = formatListingAsText(buildTrackListing([arc(1, 'A', 'Only', 60)], 'Mix'), burnedOn);
    expect(text).toContain('1 track ');
  });
});

describe('listingFileName', () => {
  it('keeps spaces and hyphens, which are ordinary in a disc title', () => {
    expect(listingFileName('Road Trip - Side A')).toBe('Road Trip - Side A track listing.txt');
  });

  it('strips characters a filesystem would refuse', () => {
    expect(listingFileName('A/B: "C"?')).toBe('AB C track listing.txt');
  });

  it('falls back when the title is empty or only punctuation', () => {
    expect(listingFileName('   ')).toBe('Mix CD track listing.txt');
    expect(listingFileName('***')).toBe('Mix CD track listing.txt');
  });
});
