import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  romanization?: string;
  romanizationRef?: (element: HTMLSpanElement | null) => void;
  translation?: string;
}

export function LyricsLineContent({ children, romanization, romanizationRef, translation }: Props) {
  return (
    <span className="lyrics-line-content">
      <span className="lyrics-line-primary">{children}</span>
      {romanization && (
        <span className="lyrics-romanization" ref={romanizationRef}>
          <span className="lyrics-romanization-base">{romanization}</span>
          <span className="lyrics-romanization-progress" aria-hidden="true">{romanization}</span>
        </span>
      )}
      {translation && <span className="lyrics-translation">{translation}</span>}
    </span>
  );
}
