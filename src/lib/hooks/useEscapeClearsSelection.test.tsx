import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useEscapeClearsSelection } from './useEscapeClearsSelection';

function Harness({ active, clear, withMenu = false }: { active: boolean; clear: () => void; withMenu?: boolean }) {
  useEscapeClearsSelection(active, clear);
  return (
    <div>
      {/* A list that swallows Escape itself, like the cursor handler does. */}
      <div data-testid="list" tabIndex={0} onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation(); }} />
      <input data-testid="field" />
      {withMenu && <div className="context-menu" />}
    </div>
  );
}

describe('useEscapeClearsSelection', () => {
  it('clears on Escape even when a focused list stops the key', () => {
    const clear = vi.fn();
    const { getByTestId } = render(<Harness active clear={clear} />);
    fireEvent.keyDown(getByTestId('list'), { key: 'Escape' });
    expect(clear).toHaveBeenCalledOnce();
  });

  it('does nothing without a selection, for other keys, or while typing', () => {
    const clear = vi.fn();
    const { getByTestId, rerender } = render(<Harness active={false} clear={clear} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    rerender(<Harness active clear={clear} />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyDown(getByTestId('field'), { key: 'Escape' });
    expect(clear).not.toHaveBeenCalled();
  });

  it('leaves Escape to an open context menu', () => {
    const clear = vi.fn();
    render(<Harness active clear={clear} withMenu />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(clear).not.toHaveBeenCalled();
  });
});
