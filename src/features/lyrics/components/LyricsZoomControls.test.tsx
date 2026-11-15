import { act } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { useLyricsAppearance } from '../hooks/useLyricsAppearance';
import { LyricsZoomControls } from './LyricsZoomControls';

function Surface() {
  const appearance = useLyricsAppearance();
  return <LyricsZoomControls {...appearance} />;
}

beforeEach(resetAuthStore);
describe('lyrics zoom buttons', () => {
  it('has one named percentage button, wheel/reset hint, keyboard focus and shared live percentages', async () => {
    const user = userEvent.setup();
    const { getAllByRole } = renderWithProviders(<><Surface /><Surface /></>);
    const badges = getAllByRole('button', { name: /Reset size/ });
    expect(getAllByRole('button')).toHaveLength(2); // One per surface; no +/− toolbar.
    expect(badges[0]).toHaveAttribute('type', 'button');
    expect(badges[0]).toHaveClass('lyrics-zoom-badge');
    expect(badges[0].title).toBe('Wheel: size · Ctrl+0: reset');
    await user.tab();
    expect(badges[0]).toHaveFocus();
    act(() => useAuthStore.getState().setLyricsScale(1.7));
    getAllByRole('button', { name: /Reset size/ }).forEach(button => expect(button).toHaveTextContent('170%'));
    await user.click(getAllByRole('button', { name: /Reset size/ })[1]);
    expect(useAuthStore.getState().lyricsScale).toBe(1);
    const writes = vi.fn();
    const unsubscribe = useAuthStore.subscribe(writes);
    try {
      await user.click(getAllByRole('button', { name: /Reset size/ })[0]);
      expect(writes).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it('stays reachable at both limits and resets with native keyboard activation', async () => {
    const { getByRole } = renderWithProviders(<Surface />);
    act(() => useAuthStore.getState().setLyricsScale(2));
    const badge = getByRole('button', { name: /Reset size/ });
    expect(badge).toHaveTextContent('200%');
    expect(badge).toBeEnabled();
    act(() => useAuthStore.getState().setLyricsScale(0.5));
    expect(badge).toHaveTextContent('50%');
    expect(badge).toBeEnabled();
    badge.focus();
    await userEvent.keyboard('{Enter}');
    expect(useAuthStore.getState().lyricsScale).toBe(1);
  });

  it('removes the actual badge, tab stop and wheel listener, then restores the current scale', async () => {
    const user = userEvent.setup();
    const { container, getByRole, queryByRole } = renderWithProviders(
      <StrictMode><button>Before</button><Surface /><button>After</button></StrictMode>,
    );
    const old = getByRole('button', { name: /Reset size/ });
    act(() => {
      useAuthStore.getState().setLyricsScale(1.6);
      useAuthStore.getState().setLyricsSizeIndicatorEnabled(false);
    });
    expect(queryByRole('button', { name: /Reset size/ })).not.toBeInTheDocument();
    expect(container.children).toHaveLength(2); // No hidden badge or empty row.
    const wheel = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
    act(() => { old.dispatchEvent(wheel); });
    expect(wheel.defaultPrevented).toBe(false);
    expect(useAuthStore.getState().lyricsScale).toBe(1.6);
    getByRole('button', { name: 'Before' }).focus();
    await user.tab();
    expect(getByRole('button', { name: 'After' })).toHaveFocus();
    act(() => useAuthStore.getState().setLyricsScale(1.8));
    act(() => useAuthStore.getState().setLyricsSizeIndicatorEnabled(true));
    const fresh = getByRole('button', { name: /Reset size/ });
    expect(fresh).not.toBe(old);
    expect(fresh).toHaveTextContent('180%');
    const nextWheel = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
    act(() => { fresh.dispatchEvent(nextWheel); });
    expect(nextWheel.defaultPrevented).toBe(true);
    expect(fresh).toHaveTextContent('190%');
  });
});
