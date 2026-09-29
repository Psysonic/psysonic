import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { OpenArtistRefInline } from './OpenArtistRefInline';

/**
 * Shapes measured against a real Navidrome library: the server splits a credit
 * string on its own separator and keeps the surrounding blanks inside the names,
 * so a two-artist track arrives as `"Name "` and `" Other Name"`.
 */
const REFS = [
  { id: 'a1', name: 'First Artist ' },
  { id: 'a2', name: ' Second Artist' },
];

describe('OpenArtistRefInline', () => {
  it('trims the blanks the server leaves in the names', () => {
    const { getByText } = render(
      <OpenArtistRefInline refs={REFS} fallbackName="unused" onGoArtist={vi.fn()} />,
    );

    // `getByText` matches on the normalised text, so assert on the node itself.
    expect(getByText('First Artist').textContent).toBe('First Artist');
    expect(getByText('Second Artist').textContent).toBe('Second Artist');
  });

  it('puts one separator between the credits and none around them', () => {
    const { container } = render(
      <OpenArtistRefInline refs={REFS} fallbackName="unused" onGoArtist={vi.fn()} />,
    );

    const separators = container.querySelectorAll('.open-artist-ref-sep');
    expect(separators).toHaveLength(1);
    // The dot is drawn and spaced by CSS. As a character it inherited whatever
    // the font does with U+2022 (it looked bottom-aligned), and literal spaces
    // would collapse against the blanks the names carry.
    expect(separators[0].textContent).toBe('');
  });

  it('still navigates per credit', () => {
    const onGoArtist = vi.fn();
    const { getByText } = render(
      <OpenArtistRefInline refs={REFS} fallbackName="unused" onGoArtist={onGoArtist} />,
    );

    fireEvent.click(getByText('Second Artist'));

    expect(onGoArtist).toHaveBeenCalledWith('a2');
  });

  it('falls back to the plain name when a credit has none', () => {
    const { getByText } = render(
      <OpenArtistRefInline refs={[{ id: 'a1', name: '  ' }]} fallbackName="Fallback" onGoArtist={vi.fn()} />,
    );

    expect(getByText('Fallback')).toBeInTheDocument();
  });
});
