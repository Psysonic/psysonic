import { describe, expect, it } from 'vitest';

import { groupLabels, labelBucket, mergeLabelCatalogs } from './labelDisplay';

describe('labelBucket', () => {
  it('buckets digits, letters, accented letters and symbols', () => {
    expect(labelBucket('4AD')).toBe('#');
    expect(labelBucket('warp')).toBe('W');
    expect(labelBucket('Éditions Mego')).toBe('E');
    expect(labelBucket('!K7')).toBe('OTHER');
    expect(labelBucket('Мелодия')).toBe('OTHER');
  });

  it('does not strip leading articles', () => {
    expect(labelBucket('The Trilogy Tapes')).toBe('T');
  });
});

describe('mergeLabelCatalogs', () => {
  it('adds album counts for the same label across servers, case-insensitively', () => {
    const merged = mergeLabelCatalogs([
      [{ value: 'Warp', albumCount: 3, songCount: 30 }, { value: 'Bleep', albumCount: 1, songCount: 4 }],
      [{ value: 'warp', albumCount: 2, songCount: 12 }, { value: ' ', albumCount: 5, songCount: 5 }],
    ]);
    expect(merged).toEqual([
      { name: 'Warp', albumCount: 5 },
      { name: 'Bleep', albumCount: 1 },
    ]);
  });
});

describe('groupLabels', () => {
  const labels = ['Warp', '4AD', 'Acid', 'ata', '!K7'].map(name => ({ name, albumCount: 1 }));

  it('orders sections # → A–Z → OTHER and sorts case-insensitively within them', () => {
    const sections = groupLabels(labels, '');
    expect(sections.map(s => s.bucket)).toEqual(['#', 'A', 'W', 'OTHER']);
    expect(sections[1].labels.map(l => l.name)).toEqual(['Acid', 'ata']);
  });

  it('filters by a case-insensitive substring', () => {
    const sections = groupLabels(labels, 'AR');
    expect(sections.flatMap(s => s.labels.map(l => l.name))).toEqual(['Warp']);
  });
});
