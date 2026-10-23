import { beforeAll, describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import CoverLightbox from '@/ui/CoverLightbox';

describe('CoverLightbox', () => {
  it('supports keyboard zoom, pan and reset without sending keys to the page', () => {
    renderWithProviders(<CoverLightbox src="cover.jpg" alt="Album cover" onClose={vi.fn()} />);
    const img = screen.getByRole('img', { name: 'Album cover' });
    const close = screen.getByRole('button', { name: 'Close' });
    Object.defineProperties(img, {
      offsetWidth: { configurable: true, value: 400 },
      offsetHeight: { configurable: true, value: 400 },
    });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: '+' });
    expect(img.style.transform).toContain('scale(1.25)');
    fireEvent.keyDown(close, { key: 'ArrowRight' });
    expect(img.style.transform).toContain('translate(-40px, 0px)');
    fireEvent.keyDown(close, { key: '0' });
    expect(img.style.transform).toBe('');
  });

  it('keeps tab focus inside the dialog and restores the opener on unmount', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = renderWithProviders(<CoverLightbox src="cover.jpg" alt="Album cover" onClose={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'Close' });
    const img = screen.getByRole('img', { name: 'Album cover' });
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(img).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(img).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('renders the cover image with the supplied src and alt', () => {
    renderWithProviders(
      <CoverLightbox src="https://example/cover.jpg" alt="Album cover" onClose={vi.fn()} />,
    );

    const img = screen.getByRole('img', { name: 'Album cover' });
    expect(img).toHaveAttribute('src', 'https://example/cover.jpg');
  });

  it('calls onClose when the overlay is clicked', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <CoverLightbox src="https://example/cover.jpg" alt="Album cover" onClose={onClose} />,
    );

    await userEvent.click(screen.getByRole('dialog'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose when the image itself is clicked (stops propagation)', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <CoverLightbox src="https://example/cover.jpg" alt="Album cover" onClose={onClose} />,
    );

    await userEvent.click(screen.getByRole('img', { name: 'Album cover' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <CoverLightbox src="https://example/cover.jpg" alt="Album cover" onClose={onClose} />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ignores other keys', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <CoverLightbox src="https://example/cover.jpg" alt="Album cover" onClose={onClose} />,
    );

    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'a' });

    expect(onClose).not.toHaveBeenCalled();
  });

  describe('zoom', () => {
    beforeAll(() => {
      // jsdom has no pointer capture; the drag-to-pan handler calls it.
      HTMLElement.prototype.setPointerCapture ??= vi.fn();
    });

    const renderLightbox = () => {
      renderWithProviders(
        <CoverLightbox src="https://example/cover.jpg" alt="Album cover" onClose={vi.fn()} />,
      );
      return {
        overlay: screen.getByRole('dialog'),
        img: screen.getByRole('img', { name: 'Album cover' }),
      };
    };

    it('zooms in on a pinch or Ctrl + wheel and blocks the page zoom', () => {
      const { overlay, img } = renderLightbox();
      const event = new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, bubbles: true, cancelable: true });
      fireEvent(overlay, event);

      expect(event.defaultPrevented).toBe(true);
      expect(img).toHaveClass('cover-lightbox-img--zoomed');
      expect(img.style.transform).toContain('scale(');
    });

    it('does not zoom on a plain wheel scroll', () => {
      const { overlay, img } = renderLightbox();
      fireEvent.wheel(overlay, { deltaY: -50 });

      expect(img).not.toHaveClass('cover-lightbox-img--zoomed');
      expect(img.style.transform).toBe('');
    });

    it('zooms with a WebKit pinch gesture and ignores the Ctrl + wheel sent alongside', () => {
      const { overlay, img } = renderLightbox();
      const gesture = (type: string, scale: number) =>
        fireEvent(overlay, Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: 0, clientY: 0 }));

      gesture('gesturestart', 1);
      gesture('gesturechange', 2);
      expect(img.style.transform).toContain('scale(2)');

      fireEvent(overlay, new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, bubbles: true, cancelable: true }));
      expect(img.style.transform).toContain('scale(2)');

      gesture('gestureend', 2);
    });

    it('toggles zoom on double-click without closing', async () => {
      const onClose = vi.fn();
      renderWithProviders(
        <CoverLightbox src="https://example/cover.jpg" alt="Album cover" onClose={onClose} />,
      );
      const img = screen.getByRole('img', { name: 'Album cover' });

      await userEvent.dblClick(img);
      expect(img).toHaveClass('cover-lightbox-img--zoomed');

      await userEvent.dblClick(img);
      expect(img).not.toHaveClass('cover-lightbox-img--zoomed');
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
