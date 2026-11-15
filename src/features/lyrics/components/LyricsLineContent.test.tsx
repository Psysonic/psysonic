import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LyricsLineContent } from './LyricsLineContent';

describe('LyricsLineContent primary pronunciation', () => {
  it('keeps original first by default and falls back per line when pronunciation is missing', () => {
    const { container, rerender } = render(<LyricsLineContent romanization="romaji">original</LyricsLineContent>);
    expect(container.querySelector('.lyrics-line-content')?.firstElementChild).toHaveClass('lyrics-line-primary');
    rerender(<LyricsLineContent romanizationPrimary>original</LyricsLineContent>);
    expect(container.querySelector('.lyrics-line-content')).not.toHaveClass('lyrics-line-content--romanization-primary');
    expect(container.querySelector('.lyrics-line-primary')).toHaveTextContent('original');
    rerender(<LyricsLineContent romanizationPrimary romanization="  ">original</LyricsLineContent>);
    expect(container.querySelector('.lyrics-line-content')).not.toHaveClass('lyrics-line-content--romanization-primary');
  });

  it('reorders existing nodes without losing original word refs, pronunciation fill or translation', () => {
    const wordRef = vi.fn();
    const pronunciationRef = vi.fn();
    const view = (primary: boolean) => (
      <LyricsLineContent romanization="romaji" romanizationRef={pronunciationRef} romanizationPrimary={primary} translation="translation">
        <span ref={wordRef}>original word</span>
      </LyricsLineContent>
    );
    const { container, rerender, unmount } = render(view(false));
    const pronunciation = container.querySelector<HTMLElement>('.lyrics-romanization')!;
    const word = container.querySelector('.lyrics-line-primary > span');
    pronunciation.style.setProperty('--lyrics-romanization-progress', '35%');
    pronunciation.classList.add('active');
    rerender(view(true));
    expect(container.querySelector('.lyrics-line-content')?.firstElementChild).toBe(pronunciation);
    expect(container.querySelector('.lyrics-line-primary > span')).toBe(word);
    expect(pronunciation.style.getPropertyValue('--lyrics-romanization-progress')).toBe('35%');
    expect(pronunciation).toHaveClass('active');
    expect(pronunciation.querySelector('.lyrics-romanization-base')).toHaveTextContent('romaji');
    expect(pronunciation.querySelector('.lyrics-romanization-progress')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.lyrics-translation')).toHaveTextContent('translation');
    expect(wordRef).toHaveBeenCalledTimes(1);
    expect(pronunciationRef).toHaveBeenCalledTimes(1);
    unmount();
    expect(pronunciationRef.mock.calls[pronunciationRef.mock.calls.length - 1]?.[0]).toBeNull();
  });
});
