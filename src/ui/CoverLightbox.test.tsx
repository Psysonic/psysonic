import { beforeAll, describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import CoverLightbox from '@/ui/CoverLightbox';

describe('CoverLightbox', () => {
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
