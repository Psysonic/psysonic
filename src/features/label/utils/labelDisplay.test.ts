import { describe, expect, it } from 'vitest';

import { cleanLabelName, groupLabels, labelBucket } from './labelDisplay';

describe('cleanLabelName', () => {
  it('trims whitespace and strips invisible direction marks', () => {
    expect(cleanLabelName(' Acid')).toBe('Acid');
    expect(cleanLabelName('Deram \u200e')).toBe('Deram');
    expect(cleanLabelName('\uFEFFWarp')).toBe('Warp');
  });
});

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

describe('groupLabels', () => {
  const tags = [
    { id: '1', value: 'Warp' },
    { id: '2', value: '4AD' },
    { id: '3', value: ' Acid' },
    { id: '4', value: 'ata' },
    { id: '5', value: '\u200e' },
    { id: '6', value: '!K7' },
  ];

  it('orders sections # → A–Z → OTHER and sorts case-insensitively within them', () => {
    const sections = groupLabels(tags, '');
    expect(sections.map(s => s.bucket)).toEqual(['#', 'A', 'W', 'OTHER']);
    expect(sections[1].labels.map(l => l.name)).toEqual(['Acid', 'ata']);
  });

  it('drops values that are empty after cleaning', () => {
    const ids = groupLabels(tags, '').flatMap(s => s.labels.map(l => l.id));
    expect(ids).not.toContain('5');
  });

  it('filters by a case-insensitive substring', () => {
    const sections = groupLabels(tags, 'AR');
    expect(sections.flatMap(s => s.labels.map(l => l.name))).toEqual(['Warp']);
  });
});
