import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, Link, useLocation } from 'react-router';
import i18n from '@/lib/i18n';
import { executeRuntimeAction } from '@/config/shortcutActions';
import { useThemeStore } from '@/store/themeStore';
import { HistoryNavButtons } from './HistoryNavButtons';

function CurrentPath() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

// The buttons read the router's entry index from `window.history.state`, which
// only the browser history writes — so this runs a real BrowserRouter on
// jsdom's history instead of the MemoryRouter `renderWithProviders` uses.
function renderShell() {
  return render(
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <HistoryNavButtons />
        <Link to="/albums">albums</Link>
        <Link to="/artists">artists</Link>
        <CurrentPath />
      </BrowserRouter>
    </I18nextProvider>,
  );
}

const back = () => screen.getByRole('button', { name: 'Back' });
const forward = () => screen.getByRole('button', { name: 'Forward' });
const path = () => screen.getByTestId('path').textContent;

describe('HistoryNavButtons', () => {
  beforeEach(() => {
    void i18n.changeLanguage('en');
    window.history.replaceState(null, '', '/');
    useThemeStore.setState({ showHistoryNavButtons: true });
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
    useThemeStore.setState({ showHistoryNavButtons: true });
  });

  it('tells in the tooltip where the buttons can be hidden', () => {
    renderShell();
    expect(back()).toHaveAttribute('data-tooltip', 'Back — Can be hidden in Settings → Appearance');
    expect(forward()).toHaveAttribute('data-tooltip', 'Forward — Can be hidden in Settings → Appearance');
  });

  it('renders nothing when hidden in the settings, while the back shortcut still works', async () => {
    useThemeStore.setState({ showHistoryNavButtons: false });
    renderShell();
    expect(screen.queryByRole('group', { name: 'Navigation history' })).toBeNull();

    fireEvent.click(screen.getByText('albums'));
    expect(path()).toBe('/albums');
    act(() => { executeRuntimeAction('navigate-back', { navigate: () => {}, previewPolicy: 'stop' }); });
    await waitFor(() => expect(path()).toBe('/'));
  });

  it('starts with both directions disabled', () => {
    renderShell();
    expect(back()).toBeDisabled();
    expect(forward()).toBeDisabled();
  });

  it('goes back and forward through visited pages', async () => {
    renderShell();
    fireEvent.click(screen.getByText('albums'));
    fireEvent.click(screen.getByText('artists'));
    expect(path()).toBe('/artists');
    expect(back()).toBeEnabled();
    expect(forward()).toBeDisabled();

    act(() => { fireEvent.click(back()); });
    await waitFor(() => expect(path()).toBe('/albums'));
    expect(back()).toBeEnabled();
    expect(forward()).toBeEnabled();

    act(() => { fireEvent.click(forward()); });
    await waitFor(() => expect(path()).toBe('/artists'));
    expect(forward()).toBeDisabled();
  });

  it('drops forward once a new page is opened after going back', async () => {
    renderShell();
    fireEvent.click(screen.getByText('albums'));
    fireEvent.click(screen.getByText('artists'));

    act(() => { fireEvent.click(back()); });
    await waitFor(() => expect(path()).toBe('/albums'));
    act(() => { fireEvent.click(back()); });
    await waitFor(() => expect(path()).toBe('/'));
    expect(forward()).toBeEnabled();

    // Two steps back, then a new page: it lands one entry before the old end,
    // so a tracker that kept the old end would still offer forward here.
    fireEvent.click(screen.getByText('artists'));
    expect(path()).toBe('/artists');
    expect(back()).toBeEnabled();
    expect(forward()).toBeDisabled();
  });

  it('labels the group for screen readers', () => {
    renderShell();
    expect(screen.getByRole('group', { name: 'Navigation history' })).toBeInTheDocument();
  });
});
