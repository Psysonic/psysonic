import { describe, expect, it } from 'vitest';
import ExplicitBadge, { ExplicitTitle } from '@/ui/ExplicitBadge';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

describe('ExplicitBadge', () => {
  it('renders an announced badge for explicit items, with no text of its own', () => {
    // The letter is CSS `::before`: an empty box has its baseline at its bottom
    // edge, which is what puts the badge flush with the title's baseline.
    const view = renderWithProviders(<ExplicitBadge status="explicit" />);
    const badge = view.getByRole('img', { name: 'Explicit' });
    expect(badge).toHaveClass('explicit-badge');
    expect(badge).toBeEmptyDOMElement();
  });

  it('renders nothing for clean or untagged items', () => {
    const clean = renderWithProviders(<ExplicitBadge status="clean" />);
    expect(clean.container).toBeEmptyDOMElement();
    const none = renderWithProviders(<ExplicitBadge />);
    expect(none.container).toBeEmptyDOMElement();
  });

  it('uses the app language for the label', () => {
    const view = renderWithProviders(<ExplicitBadge status="explicit" />, { language: 'de' });
    expect(view.getByRole('img', { name: 'Explizit' })).toBeInTheDocument();
  });
});

describe('ExplicitTitle', () => {
  it('puts the badge beside an explicit title inside one baseline-aligned box', () => {
    const view = renderWithProviders(
      <ExplicitTitle status="explicit"><span className="track-title">Song</span></ExplicitTitle>,
    );
    const wrapper = view.container.firstElementChild;
    expect(wrapper).toHaveClass('explicit-title');
    expect(wrapper?.firstElementChild).toHaveClass('track-title');
    expect(wrapper?.lastElementChild).toHaveClass('explicit-badge');
  });

  it('leaves any other title exactly as it was', () => {
    const view = renderWithProviders(
      <ExplicitTitle status="clean"><span className="track-title">Song</span></ExplicitTitle>,
    );
    expect(view.container.firstElementChild).toHaveClass('track-title');
    expect(view.container.querySelector('.explicit-title')).toBeNull();
  });
});
