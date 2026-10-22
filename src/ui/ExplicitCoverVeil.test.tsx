import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/dom/blurredCover', () => ({
  blurredCover: vi.fn(),
  peekBlurredCover: vi.fn(),
}));

import { blurredCover, peekBlurredCover } from '@/lib/dom/blurredCover';
import ExplicitCoverVeil from '@/ui/ExplicitCoverVeil';
import { useThemeStore } from '@/store/themeStore';

function Cover({ explicit, src }: { explicit: boolean; src: string }) {
  return (
    <div data-testid="host">
      <img src={src} alt="cover" />
      <ExplicitCoverVeil explicit={explicit} />
      <span>overlay</span>
    </div>
  );
}

describe('ExplicitCoverVeil', () => {
  beforeEach(() => {
    vi.mocked(peekBlurredCover).mockReturnValue(undefined);
    vi.mocked(blurredCover).mockImplementation(async src => `data:blurred:${src}`);
    useThemeStore.setState({ blurExplicitCovers: true });
  });

  afterEach(() => {
    vi.mocked(blurredCover).mockReset();
    vi.mocked(peekBlurredCover).mockReset();
    useThemeStore.setState({ blurExplicitCovers: false });
  });

  it('leaves covers of tracks that are not explicit alone', () => {
    const view = render(<Cover explicit={false} src="http://asset.localhost/a.webp" />);
    expect(view.getByTestId('host')).not.toHaveAttribute('data-explicit-veil');
    expect(view.container.querySelector('.explicit-veil')).toBeNull();
    expect(blurredCover).not.toHaveBeenCalled();
  });

  it('does nothing while the setting is off', () => {
    useThemeStore.setState({ blurExplicitCovers: false });
    const view = render(<Cover explicit src="http://asset.localhost/a.webp" />);
    expect(view.getByTestId('host')).not.toHaveAttribute('data-explicit-veil');
    expect(blurredCover).not.toHaveBeenCalled();
  });

  it('hides the cover at once and lays the blurred copy over it when ready', async () => {
    let finish: (value: string | null) => void = () => {};
    vi.mocked(blurredCover).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<Cover explicit src="http://asset.localhost/a.webp" />);
    const host = view.getByTestId('host');

    // Hidden by `[data-explicit-veil] img`, covered by a placeholder until the copy exists.
    expect(host).toHaveAttribute('data-explicit-veil');
    expect(host.querySelector('.explicit-veil--placeholder')).not.toBeNull();
    expect(blurredCover).toHaveBeenCalledWith('http://asset.localhost/a.webp');

    await act(async () => { finish('data:blurred'); });
    expect(host.querySelector('img.explicit-veil')).toHaveAttribute('src', 'data:blurred');
  });

  it('keeps the placeholder when the cover cannot be read', async () => {
    vi.mocked(blurredCover).mockResolvedValue(null);
    const view = render(<Cover explicit src="https://elsewhere.test/a.jpg" />);
    await waitFor(() => expect(blurredCover).toHaveBeenCalled());
    await act(async () => {});
    expect(view.container.querySelector('img.explicit-veil')).toBeNull();
    expect(view.container.querySelector('.explicit-veil--placeholder')).not.toBeNull();
  });

  it('follows the cover when its image changes', async () => {
    const view = render(<Cover explicit src="http://asset.localhost/a.webp" />);
    await waitFor(() => expect(view.container.querySelector('img.explicit-veil'))
      .toHaveAttribute('src', 'data:blurred:http://asset.localhost/a.webp'));

    view.rerender(<Cover explicit src="http://asset.localhost/b.webp" />);
    await waitFor(() => expect(view.container.querySelector('img.explicit-veil'))
      .toHaveAttribute('src', 'data:blurred:http://asset.localhost/b.webp'));
  });

  it('uses a copy that is already known without waiting', () => {
    vi.mocked(peekBlurredCover).mockReturnValue('data:known');
    const view = render(<Cover explicit src="http://asset.localhost/a.webp" />);
    expect(view.container.querySelector('img.explicit-veil')).toHaveAttribute('src', 'data:known');
    expect(blurredCover).not.toHaveBeenCalled();
  });

  it('shows the cover again when the setting is switched off', async () => {
    const view = render(<Cover explicit src="http://asset.localhost/a.webp" />);
    const host = view.getByTestId('host');
    expect(host).toHaveAttribute('data-explicit-veil');

    act(() => { useThemeStore.setState({ blurExplicitCovers: false }); });
    expect(host).not.toHaveAttribute('data-explicit-veil');
    expect(host.querySelector('.explicit-veil')).toBeNull();
  });
});
