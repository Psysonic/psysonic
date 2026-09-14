import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { MiniTitlebar } from './MiniTitlebar';

const t = ((key: string) => key) as unknown as TFunction;

function renderBar(customChrome: boolean) {
  return render(
    <MiniTitlebar
      trackTitle="A Song"
      alwaysOnTop
      toggleOnTop={vi.fn()}
      showMain={vi.fn()}
      closeMini={vi.fn()}
      customChrome={customChrome}
      t={t}
    />,
  );
}

describe('MiniTitlebar', () => {
  it('leaves title, drag region and close to the system frame when there is one', () => {
    const { container, queryByLabelText } = renderBar(false);
    const bar = container.querySelector('.mini-player__titlebar');

    expect(bar).toHaveClass('mini-player__titlebar--mac');
    expect(bar).not.toHaveAttribute('data-tauri-drag-region');
    expect(queryByLabelText('miniPlayer.close')).not.toBeInTheDocument();
    expect(container.querySelector('.mini-player__titlebar-spacer')).toBeInTheDocument();
  });

  it('carries title, drag region and close itself when the window has no frame', () => {
    const { container, getByLabelText, getByText } = renderBar(true);
    const bar = container.querySelector('.mini-player__titlebar');

    expect(bar).not.toHaveClass('mini-player__titlebar--mac');
    expect(bar).toHaveAttribute('data-tauri-drag-region');
    expect(getByText('A Song')).toBeInTheDocument();
    expect(getByLabelText('miniPlayer.close')).toBeInTheDocument();
  });

  it('keeps pin and open-main-window in both frames', () => {
    for (const customChrome of [false, true]) {
      const { getByLabelText, unmount } = renderBar(customChrome);
      expect(getByLabelText('miniPlayer.pinOff')).toBeInTheDocument();
      expect(getByLabelText('miniPlayer.openMainWindow')).toBeInTheDocument();
      unmount();
    }
  });
});
