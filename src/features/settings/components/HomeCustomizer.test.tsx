import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

const { availableMock } = vi.hoisted(() => ({ availableMock: vi.fn() }));

vi.mock('@/features/home/hooks/useSonicSimilarityAvailable', () => ({
  useSonicSimilarityAvailable: availableMock,
}));

import { HomeCustomizer } from '@/features/settings/components/HomeCustomizer';
import { DEFAULT_HOME_SECTIONS, useHomeStore } from '@/features/home';

function sourceRadio(name: RegExp) {
  return screen.getByRole('radio', { name });
}

describe('HomeCustomizer — Because you listened source', () => {
  beforeEach(() => {
    availableMock.mockReset();
    useHomeStore.setState({ sections: DEFAULT_HOME_SECTIONS, becauseYouLikeSource: 'similarArtists' });
  });

  afterEach(() => {
    useHomeStore.setState({ sections: DEFAULT_HOME_SECTIONS, becauseYouLikeSource: 'similarArtists' });
  });

  it('keeps AudioMuse disabled while no server has it', () => {
    availableMock.mockReturnValue(false);
    renderWithProviders(<HomeCustomizer />);

    expect(sourceRadio(/similar artists/i).getAttribute('aria-checked')).toBe('true');
    expect((sourceRadio(/audiomuse/i) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows similar artists as active when AudioMuse was chosen but is gone', () => {
    availableMock.mockReturnValue(false);
    useHomeStore.setState({ becauseYouLikeSource: 'audiomuse' });
    renderWithProviders(<HomeCustomizer />);

    expect(sourceRadio(/similar artists/i).getAttribute('aria-checked')).toBe('true');
    expect(sourceRadio(/audiomuse/i).getAttribute('aria-checked')).toBe('false');
  });

  it('switches the rail to AudioMuse once it is available', () => {
    availableMock.mockReturnValue(true);
    renderWithProviders(<HomeCustomizer />);

    fireEvent.click(sourceRadio(/audiomuse/i));
    expect(useHomeStore.getState().becauseYouLikeSource).toBe('audiomuse');
  });

  it('hides the picker while the rail itself is switched off', () => {
    availableMock.mockReturnValue(true);
    useHomeStore.setState({
      sections: DEFAULT_HOME_SECTIONS.map(s => (s.id === 'becauseYouLike' ? { ...s, visible: false } : s)),
    });
    renderWithProviders(<HomeCustomizer />);

    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('HomeCustomizer — rail order', () => {
  beforeEach(() => {
    availableMock.mockReturnValue(false);
    useHomeStore.setState({ sections: DEFAULT_HOME_SECTIONS, becauseYouLikeSource: 'similarArtists' });
  });

  it('offers a drag handle for every rail but not for the hero', () => {
    const { container } = renderWithProviders(<HomeCustomizer />);

    const rows = [...container.querySelectorAll('.sidebar-customizer-row')];
    expect(rows).toHaveLength(DEFAULT_HOME_SECTIONS.length);
    expect(rows[0]?.querySelector('.sidebar-customizer-grip')).toBeNull();
    expect(rows[0]?.hasAttribute('data-reorder-id')).toBe(false);
    for (const row of rows.slice(1)) {
      expect(row.querySelector('.sidebar-customizer-grip')).not.toBeNull();
    }
    expect(rows.slice(1).map(row => row.getAttribute('data-reorder-id')))
      .toEqual(DEFAULT_HOME_SECTIONS.slice(1).map(section => section.id));
  });

  it('lists the rails in the stored order', () => {
    const [hero, ...rails] = DEFAULT_HOME_SECTIONS;
    useHomeStore.setState({ sections: [hero!, ...[...rails].reverse()] });
    const { container } = renderWithProviders(<HomeCustomizer />);

    expect([...container.querySelectorAll('[data-reorder-id]')].map(row => row.getAttribute('data-reorder-id')))
      .toEqual([...rails].reverse().map(section => section.id));
  });
});
