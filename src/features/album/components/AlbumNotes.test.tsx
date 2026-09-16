import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { latestResizeObserver } from '@/test/mocks/browser';
import AlbumNotes from '@/features/album/components/AlbumNotes';

/**
 * jsdom computes no layout, so `scrollHeight` and `clientHeight` are both 0 and
 * nothing ever looks clipped. The expander is driven by exactly that comparison,
 * so these tests stage it on the element itself — otherwise the button could
 * never appear and a test asserting its absence would pass for the wrong reason.
 */
function stageClipping(clipped: boolean) {
  const el = document.querySelector('.album-notes-text');
  if (!el) throw new Error('the description element is not rendered');
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: clipped ? 120 : 40 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 40 });
  // Re-run the component's own measurement through the observer it registered,
  // which is the path the real app takes on a resize or a late font swap.
  latestResizeObserver()?.emit();
  return el;
}

describe('AlbumNotes', () => {
  it('renders nothing when there is neither a comment nor a description', () => {
    const { container } = renderWithProviders(<AlbumNotes comment={null} description={null} />);
    expect(container.querySelector('.album-notes')).toBeNull();
  });

  it('shows the comment on its own', () => {
    renderWithProviders(<AlbumNotes comment="Remaster 2024" description={null} />);
    expect(screen.getByText('Remaster 2024')).toBeTruthy();
    expect(document.querySelector('.album-notes-description')).toBeNull();
  });

  it('puts the comment before the description', () => {
    // Order is the point: a paragraph first would bury the one line someone
    // deliberately tagged the release with.
    const { container } = renderWithProviders(
      <AlbumNotes comment="Remaster 2024" description="A studio album." />,
    );
    const rendered = container.querySelector('.album-notes')!.textContent ?? '';
    expect(rendered.indexOf('Remaster 2024')).toBeLessThan(rendered.indexOf('A studio album.'));
  });

  it('strips markup the server sent but keeps the text', () => {
    renderWithProviders(
      <AlbumNotes comment={null} description={'<script>alert(1)</script>Third studio album.'} />,
    );
    const el = document.querySelector('.album-notes-text')!;
    expect(el.textContent).toContain('Third studio album.');
    expect(el.querySelector('script')).toBeNull();
  });

  it('offers no expander while the description fits', () => {
    renderWithProviders(<AlbumNotes comment={null} description="Short." />);
    stageClipping(false);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('expands and collapses when the description is clipped', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AlbumNotes comment={null} description={'A long description. '.repeat(40)} />,
    );
    const el = stageClipping(true);

    const toggle = await screen.findByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el.classList.contains('is-expanded')).toBe(false);

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.album-notes-text')!.classList.contains('is-expanded')).toBe(true);

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
