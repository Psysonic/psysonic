export type RomanizationProgressState = 'upcoming' | 'active' | 'played';

export function romanizationProgressForWord(
  wordCount: number,
  wordIndex: number,
  wordProgress = 1,
): number {
  if (wordCount <= 0 || wordIndex < 0) return 0;
  const activeProgress = Math.min(1, Math.max(0, wordProgress));
  return Math.min(100, ((wordIndex + activeProgress) / wordCount) * 100);
}

export function setRomanizationProgress(
  element: HTMLSpanElement | null,
  state: RomanizationProgressState,
  progress: number,
): void {
  if (!element) return;
  element.className = `lyrics-romanization${state === 'upcoming' ? '' : ` ${state}`}`;
  const percent = Math.round(Math.max(0, Math.min(100, progress)) * 100) / 100;
  element.style.setProperty('--lyrics-romanization-progress', `${percent}%`);
}
