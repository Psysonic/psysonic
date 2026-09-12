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

  it('updates the karaoke overlay state and clamps its progress', () => {
    const element = document.createElement('span');
    setRomanizationProgress(element, 'active', 125);
    expect(element).toHaveClass('lyrics-romanization', 'active');
    expect(element.style.getPropertyValue('--lyrics-romanization-progress')).toBe('100%');
  });
});
