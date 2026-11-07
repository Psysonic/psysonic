import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { ColDef } from '@/lib/hooks/useTracklistColumns';
import { useThemeStore } from '@/store/themeStore';
import { TracklistCell } from '@/ui/tracklist/TracklistCell';

const ARTIST: ColDef = { key: 'artist', i18nKey: 'trackArtist', minWidth: 80, defaultWidth: 180, required: false };
const DURATION: ColDef = { key: 'duration', i18nKey: 'trackDuration', minWidth: 72, defaultWidth: 92, required: false, align: 'end' };

function clip(node: Element, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(node, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(node, 'clientWidth', { configurable: true, value: clientWidth });
}

afterEach(() => {
  useThemeStore.setState({ showCardTooltips: true });
});

describe('TracklistCell', () => {
  it('aligns the cell like its column', () => {
    const { container } = render(<TracklistCell col={DURATION}>3:12</TracklistCell>);
    expect(container.firstElementChild).toHaveClass('tl-cell', 'tl-cell--end');
    expect(container.firstElementChild).toHaveAttribute('data-tl-col', 'duration');
  });

  it('carries its text for measuring', () => {
    const { container } = render(<TracklistCell col={ARTIST} text="Some Artist"><span>Some Artist</span></TracklistCell>);
    expect(container.firstElementChild).toHaveAttribute('data-tl-text', 'Some Artist');
  });

  it('shows the full text on hover when something inside is cut off', () => {
    const { container } = render(<TracklistCell col={ARTIST} text="Some Very Long Artist"><span className="inner">Some Very Long Artist</span></TracklistCell>);
    const cell = container.firstElementChild as HTMLElement;
    clip(cell, 180, 180);
    clip(cell.querySelector('.inner')!, 260, 160);
    fireEvent.mouseEnter(cell);
    expect(cell).toHaveAttribute('data-tooltip', 'Some Very Long Artist');
  });

  it('shows no tooltip when the text fits', () => {
    const { container } = render(<TracklistCell col={ARTIST} text="Short"><span className="inner">Short</span></TracklistCell>);
    const cell = container.firstElementChild as HTMLElement;
    clip(cell, 180, 180);
    clip(cell.querySelector('.inner')!, 40, 160);
    fireEvent.mouseEnter(cell);
    expect(cell).not.toHaveAttribute('data-tooltip');
  });

  it('shows no tooltip when tooltips for cut-off names are switched off', () => {
    useThemeStore.setState({ showCardTooltips: false });
    const { container } = render(<TracklistCell col={ARTIST} text="Some Very Long Artist"><span className="inner">x</span></TracklistCell>);
    const cell = container.firstElementChild as HTMLElement;
    clip(cell.querySelector('.inner')!, 260, 160);
    fireEvent.mouseEnter(cell);
    expect(cell).not.toHaveAttribute('data-tooltip');
  });
});
