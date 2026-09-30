import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { useThemeStore } from '@/store/themeStore';
import { InputTab } from './InputTab';

describe('InputTab row click to play', () => {
  afterEach(() => {
    useThemeStore.setState({ trackRowPlayClick: 'single' });
  });

  it('switches song rows between single and double click', () => {
    renderWithProviders(<InputTab />);
    const group = screen.getByRole('radiogroup', { name: 'Play a song from a list' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Single click' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: 'Double click' }));
    expect(useThemeStore.getState().trackRowPlayClick).toBe('double');
    expect(screen.getByRole('radio', { name: 'Double click' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('InputTab touchpad swipe', () => {
  afterEach(() => {
    useThemeStore.setState({ touchpadSwipeNavigation: true });
  });

  it('turns swipe-to-navigate off and on', () => {
    renderWithProviders(<InputTab />);
    const toggle = screen.getByRole('checkbox', { name: 'Swipe to go back and forward' });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(useThemeStore.getState().touchpadSwipeNavigation).toBe(false);
  });
});
