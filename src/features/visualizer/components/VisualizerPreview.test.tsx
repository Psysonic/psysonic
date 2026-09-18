import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { useVisualizerStore } from '@/features/visualizer/store/visualizerStore';

const hoisted = vi.hoisted(() => ({
  canvasProps: null as null | {
    demoWhenIdle?: boolean;
    onLiveChange?: (live: boolean) => void;
    artUrl: string;
  },
}));

vi.mock('@/features/visualizer/components/VisualizerCanvas', () => ({
  default: (props: NonNullable<typeof hoisted.canvasProps>) => {
    hoisted.canvasProps = props;
    return <canvas />;
  },
}));
vi.mock('@/features/visualizer/hooks/useVisualizerCoverArt', () => ({
  useVisualizerCoverArt: () => ({ artUrl: 'cover.jpg', artKey: 'album-1' }),
}));

import VisualizerPreview from './VisualizerPreview';

describe('VisualizerPreview', () => {
  beforeEach(() => {
    hoisted.canvasProps = null;
    useVisualizerStore.setState({ mode: 'bars' });
  });

  it('runs the canvas with the demo fallback and the playing cover', () => {
    renderWithProviders(<VisualizerPreview />);

    expect(screen.getByRole('group', { name: 'Preview' })).toBeInTheDocument();
    expect(hoisted.canvasProps?.demoWhenIdle).toBe(true);
    expect(hoisted.canvasProps?.artUrl).toBe('cover.jpg');
  });

  it('says whether it shows the demo or the current playback', () => {
    renderWithProviders(<VisualizerPreview />);
    expect(screen.getByText('Showing a demo signal while nothing is playing.')).toBeInTheDocument();

    act(() => hoisted.canvasProps?.onLiveChange?.(true));
    expect(screen.getByText('Showing the current playback.')).toBeInTheDocument();

    act(() => hoisted.canvasProps?.onLiveChange?.(false));
    expect(screen.getByText('Showing a demo signal while nothing is playing.')).toBeInTheDocument();
  });

  it('takes the frame styling of the selected mode', () => {
    useVisualizerStore.setState({ mode: 'radial' });
    const { container } = renderWithProviders(<VisualizerPreview />);

    // The opaque field the radial trail needs keys on this attribute.
    expect(container.querySelector('.psy-viz-panel')).toHaveAttribute('data-mode', 'radial');
  });
});
