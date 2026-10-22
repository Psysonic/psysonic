import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MiniControls } from './MiniControls';

describe('MiniControls album skip', () => {
  it('sends a track skip on a plain click and an album skip on Alt+click', () => {
    const control = vi.fn();
    const { container } = render(
      <MiniControls isPlaying currentTime={0} duration={100} progress={0} control={control} />,
    );
    const [prev, , next] = Array.from(container.querySelectorAll('.mini-player__btn'));

    fireEvent.click(prev);
    fireEvent.click(next);
    fireEvent.click(prev, { altKey: true });
    fireEvent.click(next, { altKey: true });

    expect(control.mock.calls.map(call => call[0])).toEqual(['prev', 'next', 'prev-album', 'next-album']);
  });
});
