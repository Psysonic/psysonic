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
