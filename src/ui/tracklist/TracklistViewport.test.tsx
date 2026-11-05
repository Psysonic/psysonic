import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { TracklistViewport } from '@/ui/tracklist/TracklistViewport';

function stubClientWidth(px: number) {
  return vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tl-body') ? px : 0;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TracklistViewport', () => {
  it('shows the horizontal bar when the columns are wider than the view', () => {
    stubClientWidth(500);
    const { container } = render(
      <TracklistViewport header={<div>head</div>} contentWidth={900}><div>rows</div></TracklistViewport>,
    );
    expect(container.querySelector('.tl-hbar')).not.toBeNull();
  });

  it('keeps the bar out of the keyboard tab order', () => {
    stubClientWidth(500);
    const { container } = render(
      <TracklistViewport header={<div>head</div>} contentWidth={900}><div>rows</div></TracklistViewport>,
    );
    const bar = container.querySelector('.tl-hbar') as HTMLElement;
    expect(bar.tabIndex).toBe(-1);
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows no horizontal bar when the columns fit', () => {
    stubClientWidth(900);
    const { container } = render(
      <TracklistViewport header={<div>head</div>} contentWidth={500}><div>rows</div></TracklistViewport>,
    );
    expect(container.querySelector('.tl-hbar')).toBeNull();
  });

  it('scrolls rows and header together with the bar', () => {
    stubClientWidth(500);
    const { container } = render(
      <TracklistViewport header={<div>head</div>} contentWidth={900}><div>rows</div></TracklistViewport>,
    );
    const bar = container.querySelector('.tl-hbar') as HTMLElement;
    const body = container.querySelector('.tl-body') as HTMLElement;
    const head = container.querySelector('.tl-head-clip') as HTMLElement;
    act(() => {
      bar.scrollLeft = 120;
      fireEvent.scroll(bar);
    });
    expect(body.scrollLeft).toBe(120);
    expect(head.scrollLeft).toBe(120);
  });

  it('moves the bar and header when the rows are scrolled sideways', () => {
    stubClientWidth(500);
    const { container } = render(
      <TracklistViewport header={<div>head</div>} contentWidth={900}><div>rows</div></TracklistViewport>,
    );
    const bar = container.querySelector('.tl-hbar') as HTMLElement;
    const body = container.querySelector('.tl-body') as HTMLElement;
    const head = container.querySelector('.tl-head-clip') as HTMLElement;
    act(() => {
      body.scrollLeft = 75;
      fireEvent.scroll(body);
    });
    expect(bar.scrollLeft).toBe(75);
    expect(head.scrollLeft).toBe(75);
  });

  it('keeps the rows aligned when keyboard focus scrolls the header', () => {
    stubClientWidth(500);
    const { container } = render(
      <TracklistViewport header={<div>head</div>} contentWidth={900}><div>rows</div></TracklistViewport>,
    );
    const body = container.querySelector('.tl-body') as HTMLElement;
    const head = container.querySelector('.tl-head-clip') as HTMLElement;
    act(() => {
      head.scrollLeft = 60;
      fireEvent.scroll(head);
    });
    expect(body.scrollLeft).toBe(60);
  });

  it('scrolls sideways when the touchpad or wheel moves sideways over the header', () => {
    stubClientWidth(500);
    const { container } = render(
      <TracklistViewport header={<div>head</div>} contentWidth={900}><div>rows</div></TracklistViewport>,
    );
    const bar = container.querySelector('.tl-hbar') as HTMLElement;
    const body = container.querySelector('.tl-body') as HTMLElement;
    const head = container.querySelector('.tl-head-clip') as HTMLElement;
    fireEvent.wheel(head, { deltaX: 40 });
    expect(body.scrollLeft).toBe(40);
    expect(bar.scrollLeft).toBe(40);
    expect(head.scrollLeft).toBe(40);
  });

  it('scrolls sideways on Shift + wheel over the header', () => {
    stubClientWidth(500);
    const { container } = render(
      <TracklistViewport header={<div>head</div>} contentWidth={900}><div>rows</div></TracklistViewport>,
    );
    const body = container.querySelector('.tl-body') as HTMLElement;
    fireEvent.wheel(container.querySelector('.tl-head-clip') as HTMLElement, { deltaY: 30, shiftKey: true });
    expect(body.scrollLeft).toBe(30);
  });

  it('leaves a plain vertical wheel over the header to the page', () => {
    stubClientWidth(500);
    const { container } = render(
      <TracklistViewport header={<div>head</div>} contentWidth={900}><div>rows</div></TracklistViewport>,
    );
    const body = container.querySelector('.tl-body') as HTMLElement;
    fireEvent.wheel(container.querySelector('.tl-head-clip') as HTMLElement, { deltaY: 30 });
    expect(body.scrollLeft).toBe(0);
  });

  it('lays header and rows out at the full column width', () => {
    stubClientWidth(500);
    const { container } = render(
      <TracklistViewport header={<div>head</div>} contentWidth={900}><div>rows</div></TracklistViewport>,
    );
    const bodyContent = container.querySelector('.tl-body > div') as HTMLElement;
    const headContent = container.querySelector('.tl-head-clip > div') as HTMLElement;
    expect(bodyContent.style.width).toBe('900px');
    expect(headContent.style.width).toBe('900px');
  });
});
