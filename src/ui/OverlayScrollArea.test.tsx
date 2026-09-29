import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OverlayScrollArea, { OverlayTextarea } from '@/ui/OverlayScrollArea';

describe('OverlayScrollArea', () => {
  it('keeps the viewport ref attached while scroll updates the overlay thumb', async () => {
    const viewportRef = vi.fn();
    const view = render(
      <OverlayScrollArea viewportRef={viewportRef}>
        <div>Scrollable content</div>
      </OverlayScrollArea>,
    );
    const viewport = view.container.querySelector<HTMLElement>('.overlay-scroll__viewport');
    expect(viewport).not.toBeNull();

    Object.defineProperties(viewport!, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    viewport!.style.overflowY = 'auto';
    fireEvent(window, new Event('resize'));

    const thumb = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.overlay-scroll__thumb');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    viewportRef.mockClear();

    viewport!.scrollTop = 150;
    fireEvent.scroll(viewport!);

    await waitFor(() => expect(thumb.style.transform).toBe('translateY(38px)'));
    expect(viewportRef).not.toHaveBeenCalled();
  });
});

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
