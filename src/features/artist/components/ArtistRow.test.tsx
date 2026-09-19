import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SubsonicArtist } from '@/lib/api/subsonicTypes';

vi.mock('@/features/artist/components/ArtistCardLocal', () => ({
  default: ({ artist }: { artist: SubsonicArtist }) => <div>{artist.name}</div>,
}));

import ArtistRow from './ArtistRow';

const artists: SubsonicArtist[] = [{ id: 'artist-1', name: 'Artist One' }];

function renderRow(onTitleClick?: () => void) {
  return render(
    <MemoryRouter>
      <ArtistRow title="Artists" artists={artists} onTitleClick={onTitleClick} />
    </MemoryRouter>,
  );
}

describe('ArtistRow heading', () => {
  it('is a button that calls onTitleClick when one is given', () => {
    const onTitleClick = vi.fn();
    renderRow(onTitleClick);

    fireEvent.click(screen.getByRole('button', { name: 'Artists' }));
    expect(onTitleClick).toHaveBeenCalledTimes(1);
  });

  it('stays a plain heading without onTitleClick', () => {
    renderRow();

    expect(screen.getByRole('heading', { name: 'Artists' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Artists' })).toBeNull();
  });
});
