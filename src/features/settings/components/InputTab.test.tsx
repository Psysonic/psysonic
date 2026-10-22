import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { useThemeStore } from '@/store/themeStore';
import { useKeybindingsStore } from '@/store/keybindingsStore';
import { useGlobalShortcutsStore } from '@/store/globalShortcutsStore';
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

describe('InputTab shortcut capture', () => {
  function badges(label: string): HTMLElement[] {
    return screen.getAllByText(label).map(
      text => (text.parentElement as HTMLElement).querySelector('.keybind-badge') as HTMLElement,
    );
  }

  beforeEach(() => {
    useKeybindingsStore.getState().resetToDefaults();
    useGlobalShortcutsStore.setState({ shortcuts: {} });
  });

  it('binds the key only to the field clicked last', () => {
    renderWithProviders(<InputTab />);
    fireEvent.click(badges('Previous track')[0]);
    fireEvent.click(badges('Next track')[0]);
    fireEvent.keyDown(window, { code: 'KeyM', altKey: true });

    const { bindings } = useKeybindingsStore.getState();
    expect(bindings.next).toBe('alt+KeyM');
    expect(bindings.prev).toBeNull();
  });

  it('stops listening when the same field is clicked again', () => {
    renderWithProviders(<InputTab />);
    const next = badges('Next track')[0];
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.keyDown(window, { code: 'KeyM', altKey: true });

    expect(useKeybindingsStore.getState().bindings.next).toBeNull();
  });

  it('lets only one field listen across the in-app and global lists', () => {
    renderWithProviders(<InputTab />);
    const [inApp, global] = badges('Next track');
    fireEvent.click(inApp);
    fireEvent.click(global);
    fireEvent.keyDown(window, { code: 'KeyM', altKey: true });

    expect(useKeybindingsStore.getState().bindings.next).toBeNull();
    expect(useGlobalShortcutsStore.getState().shortcuts.next).toBe('alt+KeyM');
  });

  it('stops listening when the tab is left', () => {
    const { unmount } = renderWithProviders(<InputTab />);
    fireEvent.click(badges('Next track')[0]);
    unmount();
    fireEvent.keyDown(window, { code: 'KeyM', altKey: true });

    expect(useKeybindingsStore.getState().bindings.next).toBeNull();
  });
});
