import { describe, expect, it } from 'vitest';
import {
  romanizationProgressForWord,
  setRomanizationProgress,
} from './romanizationProgress';

describe('romanization progress', () => {
  it('maps the active word to cumulative line progress', () => {
    expect(romanizationProgressForWord(4, -1)).toBe(0);
    expect(romanizationProgressForWord(4, 0)).toBe(25);
    expect(romanizationProgressForWord(4, 3)).toBe(100);
  });

  it('includes continuous progress through the active word', () => {
    expect(romanizationProgressForWord(4, 0, 0.5)).toBe(12.5);
    expect(romanizationProgressForWord(4, 1, 0)).toBe(25);
    expect(romanizationProgressForWord(4, 1, 0.5)).toBe(37.5);
    expect(romanizationProgressForWord(4, 1, 2)).toBe(50);
  });

  it('updates the karaoke overlay state and clamps its progress', () => {
    const element = document.createElement('span');
    setRomanizationProgress(element, 'active', 125);
    expect(element).toHaveClass('lyrics-romanization', 'active');
    expect(element.style.getPropertyValue('--lyrics-romanization-progress')).toBe('100%');
  });
});
