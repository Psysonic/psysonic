export type RomanizationProgressState = 'upcoming' | 'active' | 'played';

export function romanizationProgressForWord(wordCount: number, wordIndex: number): number {
  if (wordCount <= 0 || wordIndex < 0) return 0;
  return Math.min(100, ((wordIndex + 1) / wordCount) * 100);
}

export function setRomanizationProgress(
  element: HTMLSpanElement | null,
  state: RomanizationProgressState,
  progress: number,
): void {
  if (!element) return;
  element.className = `lyrics-romanization${state === 'upcoming' ? '' : ` ${state}`}`;
  element.style.setProperty('--lyrics-romanization-progress', `${Math.max(0, Math.min(100, progress))}%`);
}
