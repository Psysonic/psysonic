import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverlayTextarea } from '@/ui/OverlayScrollArea';

describe('OverlayTextarea', () => {
  it('uses the shared overlay thumb for textarea scrolling', async () => {
    const view = render(
      <OverlayTextarea
        aria-label="JSON"
        readOnly
        rows={6}
        style={{ overflowY: 'auto' }}
        value={'line\n'.repeat(80)}
      />,
    );
    const textarea = view.getByRole('textbox', { name: 'JSON' });

    Object.defineProperties(textarea, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    fireEvent(window, new Event('resize'));

    const thumb = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.overlay-scroll__thumb');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(textarea).toHaveClass('overlay-scroll__viewport');
    expect(textarea.closest('.overlay-textarea')).not.toBeNull();
    expect(thumb.style.height).toBe('25px');

    textarea.scrollTop = 150;
    fireEvent.scroll(textarea);

    await waitFor(() => expect(thumb.style.transform).toBe('translateY(38px)'));
  });
});
