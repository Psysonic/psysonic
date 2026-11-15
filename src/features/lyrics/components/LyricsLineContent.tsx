import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  romanization?: string;
  romanizationPrimary?: boolean;
  romanizationRef?: (element: HTMLSpanElement | null) => void;
  translation?: string;
}

export function LyricsLineContent({ children, romanization, romanizationPrimary = false, romanizationRef, translation }: Props) {
  const preferRomanization = romanizationPrimary && !!romanization?.trim();
  const original = <span key="original" className="lyrics-line-primary">{children}</span>;
  const pronunciation = romanization && (
    <span key="romanization" className="lyrics-romanization" ref={romanizationRef}>
      <span className="lyrics-romanization-base">{romanization}</span>
      <span className="lyrics-romanization-progress" aria-hidden="true">{romanization}</span>
    </span>
  );
  return (
    <span className={`lyrics-line-content${preferRomanization ? ' lyrics-line-content--romanization-primary' : ''}`}>
      {preferRomanization ? [pronunciation, original] : [original, pronunciation]}
      {translation && <span className="lyrics-translation">{translation}</span>}
    </span>
  );
}
