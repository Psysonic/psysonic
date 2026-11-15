import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { latestResizeObserver } from '@/test/mocks/browser';
import { useLyricsRailLayout } from './useLyricsRailLayout';

interface Row { top?: number; height: number }
interface Chrome { height: number; clusterTop: number; closeBottom?: number; top?: number }
function Rail({ active = 0, rows, visible = true, chrome, badgeHeight = 0 }: { active?: number; rows: Row[]; visible?: boolean; chrome?: Chrome; badgeHeight?: number }) {
  const ref = useLyricsRailLayout(active);
  // jsdom has no layout engine. Model the production CSS row cap using its
  // published custom property; browser acceptance still verifies real CSS.
  const rowHeight = (node: HTMLElement, row: Row) => {
    const cap = parseFloat(node.closest<HTMLElement>('[data-testid="overlay"]')?.style.getPropertyValue('--lyrics-rail-row-max') ?? '');
    return Math.min(row.height, Number.isFinite(cap) ? cap : Infinity);
  };
  const overlay = visible ? (
    <div className="fsr-lyrics-surface" data-testid="surface">
      {badgeHeight > 0 && <button className="lyrics-zoom-badge" data-testid="badge" ref={node => {
        if (node) Object.defineProperty(node, 'offsetHeight', { configurable: true, value: badgeHeight });
      }}>100%</button>}
    <div ref={ref} data-testid="overlay">
      <div className="fsr-lyrics-rail" data-testid="rail">
        {rows.map((row, i) => <div key={i} ref={node => {
          if (!node) return;
          Object.defineProperties(node, {
            offsetTop: { configurable: true, get: () => row.top ?? rows.slice(0, i).reduce((sum, previous) => sum + rowHeight(node, previous), 0) },
            offsetHeight: { configurable: true, get: () => rowHeight(node, row) },
          });
          node.getBoundingClientRect = () => new DOMRect(0, 0, 400, rowHeight(node, row));
        }}><span className="lyrics-line-content">wrapped lyrics with pronunciation and translation</span></div>)}
      </div>
    </div>
    </div>
  ) : null;
  return chrome ? (
    <div className="fs-player" data-testid="player" ref={node => {
      if (!node) return;
      Object.defineProperty(node, 'clientHeight', { configurable: true, get: () => chrome.height });
      node.getBoundingClientRect = () => new DOMRect(0, chrome.top ?? 0, 1920, chrome.height);
    }}>
      <button className="fs-close" ref={node => {
        if (node) node.getBoundingClientRect = () => new DOMRect(24, (chrome.top ?? 0) + (chrome.closeBottom ?? 64) - 44, 44, 44);
      }} />
      {overlay}
      <div className="fs-cluster" data-testid="cluster" ref={node => {
        if (node) node.getBoundingClientRect = () => new DOMRect(64, (chrome.top ?? 0) + chrome.clusterTop, 700, Math.max(1, chrome.height - chrome.clusterTop - 72));
      }} />
    </div>
  ) : overlay;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function resize() {
  act(() => { latestResizeObserver()!.emit(); vi.advanceTimersByTime(20); });
}

describe('measured rail geometry', () => {
  it('remeasures badge removal/restoration on commit without stale space or observations', () => {
    const chrome = { height: 1000, clusterTop: 750 };
    const rows = [{ height: 60 }];
    const { getByTestId, queryByTestId, rerender } = render(<Rail badgeHeight={24} rows={rows} chrome={chrome} />);
    const oldBadge = getByTestId('badge');
    const overlay = getByTestId('overlay');
    const observer = latestResizeObserver()!;
    expect(overlay.style.getPropertyValue('--lyrics-rail-top')).toBe('182px');
    rerender(<Rail badgeHeight={0} rows={rows} chrome={chrome} />);
    expect(queryByTestId('badge')).toBeNull();
    expect(overlay.style.getPropertyValue('--lyrics-rail-top')).toBe('150px');
    expect(observer.unobserve).toHaveBeenCalledWith(oldBadge);
    expect(observer.disconnect).not.toHaveBeenCalled();
    expect(parseFloat(overlay.style.height) + 150).toBeLessThanOrEqual(742);
    rerender(<Rail badgeHeight={28} rows={rows} chrome={chrome} />);
    expect(overlay.style.getPropertyValue('--lyrics-rail-top')).toBe('186px');
    expect(observer.observe).toHaveBeenCalledWith(getByTestId('badge'));
    expect(parseFloat(overlay.style.height) + 186).toBeLessThanOrEqual(742);
  });

  it('reserves the actual compact badge height above text while respecting the cluster', () => {
    const chrome = { height: 1000, clusterTop: 750 };
    const { getByTestId } = render(<Rail badgeHeight={24} rows={[{ height: 60 }]} chrome={chrome} />);
    expect(getByTestId('surface').style.getPropertyValue('--lyrics-rail-badge-top')).toBe('150px');
    expect(getByTestId('overlay').style.getPropertyValue('--lyrics-rail-top')).toBe('182px');
    expect(parseFloat(getByTestId('overlay').style.height) + 182).toBeLessThanOrEqual(742);
    expect(latestResizeObserver()!.observe).toHaveBeenCalledWith(getByTestId('badge'));
  });

  // Characterization for the reported song-start gap, not its unapproved fix.
  it.each([1, 2])('reproduces leading empty rail space before/at the first timestamp (scale %s)', scale => {
    const chrome = { height: 1000, clusterTop: 750 };
    const rowHeight = 60 * scale;
    const rows = Array.from({ length: 5 }, () => ({ height: rowHeight }));
    const { getByTestId, rerender } = render(<Rail active={-1} badgeHeight={24} rows={rows} chrome={chrome} />);
    const overlay = getByTestId('overlay');
    const rail = getByTestId('rail');
    const top = parseFloat(overlay.style.getPropertyValue('--lyrics-rail-top'));
    const shift = () => parseFloat(rail.style.transform.slice('translateY('.length));
    const leadingGap = 150 - rowHeight / 2;
    expect(top).toBe(182);
    expect(shift()).toBe(leadingGap); // 120px at 100%; 90px at 200%.
    expect(top + shift()).toBe(scale === 1 ? 302 : 272);
    rerender(<Rail active={0} badgeHeight={24} rows={rows} chrome={chrome} />);
    expect(shift()).toBe(leadingGap); // First timestamp does not remove the gap.
    rerender(<Rail active={2} badgeHeight={24} rows={rows} chrome={chrome} />);
    expect(shift()).toBe(leadingGap - 2 * rowHeight);
    // Normal middle-line anchoring is identical: preceding lyrics, not a
    // different anchor, fill the otherwise empty two slots above the active row.
    expect(top + shift() + 2 * rowHeight + rowHeight / 2).toBe(332);
  });
  it('matches the old five 6vh slots at 100%, even before the first active line', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ top: i * 60, height: 60 }));
    const { getByTestId, rerender } = render(<Rail active={-1} rows={rows} />);
    expect(getByTestId('overlay').style.height).toBe('300px');
    expect(getByTestId('rail').style.transform).toBe('translateY(120px)');
    rerender(<Rail active={3} rows={rows} />);
    expect(getByTestId('rail').style.transform).toBe('translateY(-60px)');
  });

  it('centres variable wrapped/zoomed rows rather than multiplying an obsolete slot height', () => {
    const { getByTestId, rerender } = render(<Rail active={1} rows={[{ top: 0, height: 60 }, { top: 60, height: 60 }]} />);
    const previousObserver = latestResizeObserver()!;
    rerender(<Rail active={1} rows={[{ top: 0, height: 240 }, { top: 240, height: 360 }]} />);
    expect(previousObserver.disconnect).not.toHaveBeenCalled();
    expect(getByTestId('overlay').style.height).toBe('600px');
    expect(getByTestId('rail').style.transform).toBe('translateY(-119px)');
    // The 358px capped row has 121px above/below it, inside the mask's
    // unmasked middle 60% with a 1px rounding inset on each edge.
    expect(latestResizeObserver()!.observe).toHaveBeenCalledTimes(3);
  });

  it('preserves five 6vh slots when there is room above the real fullscreen cluster', () => {
    const chrome = { height: 1000, clusterTop: 750 };
    const rows = Array.from({ length: 5 }, () => ({ height: 60 }));
    const { getByTestId } = render(<Rail active={2} rows={rows} chrome={chrome} />);
    expect(getByTestId('overlay').style.getPropertyValue('--lyrics-rail-top')).toBe('150px');
    expect(getByTestId('overlay').style.height).toBe('300px');
    expect(getByTestId('rail').style.transform).toBe('translateY(0px)');
  });

  it('constrains the reproduced 937px viewport to the actual cluster, not a 60vh overlay', () => {
    const chrome = { height: 937, clusterTop: 494.016 };
    const { getByTestId } = render(<Rail rows={[{ height: 2001 }]} chrome={chrome} />);
    const overlay = getByTestId('overlay');
    const top = parseFloat(overlay.style.getPropertyValue('--lyrics-rail-top'));
    const height = parseFloat(overlay.style.height);
    const cap = parseFloat(overlay.style.getPropertyValue('--lyrics-rail-row-max'));
    expect(top + height).toBeLessThanOrEqual(chrome.clusterTop - 8);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThan(height * 0.6);
    expect(cap).toBeLessThan(chrome.height * 0.36);
    expect(top).toBeGreaterThanOrEqual(72);
  });

  it('remeasures when cluster wrapping or controls change its height and when its position moves', async () => {
    const chrome = { height: 1000, clusterTop: 750 };
    const { getByTestId } = render(<Rail rows={[{ height: 2000 }]} chrome={chrome} />);
    const overlay = getByTestId('overlay');
    const observer = latestResizeObserver()!;
    expect(observer.observe).toHaveBeenCalledWith(getByTestId('cluster'));
    chrome.clusterTop = 400;
    resize();
    expect(parseFloat(overlay.style.getPropertyValue('--lyrics-rail-top')) + parseFloat(overlay.style.height)).toBeLessThanOrEqual(392);
    chrome.clusterTop = 300;
    await act(async () => { getByTestId('cluster').style.bottom = '100px'; });
    act(() => { vi.advanceTimersByTime(20); });
    expect(parseFloat(overlay.style.getPropertyValue('--lyrics-rail-top')) + parseFloat(overlay.style.height)).toBeLessThanOrEqual(292);
    const cap = overlay.style.getPropertyValue('--lyrics-rail-row-max');
    chrome.clusterTop = 600;
    await act(async () => { getByTestId('player').style.setProperty('--fs-cluster-bottom', '64px'); });
    act(() => { vi.advanceTimersByTime(20); });
    expect(parseFloat(overlay.style.getPropertyValue('--lyrics-rail-row-max'))).toBeGreaterThan(parseFloat(cap));
    const set = vi.spyOn(overlay.style, 'setProperty');
    resize();
    expect(set).not.toHaveBeenCalled(); // Stable geometry cannot feed an observer write loop.
  });

  it('caps row minimum/content for small viewports and hides only when no region remains', () => {
    const chrome = { height: 300, clusterTop: 110, top: 40 };
    const { getByTestId, rerender } = render(<Rail rows={[{ height: 300 }]} chrome={chrome} />);
    const overlay = getByTestId('overlay');
    expect(overlay.style.getPropertyValue('--lyrics-rail-top')).toBe('72px'); // Root-relative, despite an entrance transform.
    expect(parseFloat(overlay.style.getPropertyValue('--lyrics-rail-top')) + parseFloat(overlay.style.height)).toBeLessThanOrEqual(102);
    expect(parseFloat(overlay.style.getPropertyValue('--lyrics-rail-row-max'))).toBeLessThan(18);
    expect(overlay.style.visibility).not.toBe('hidden');
    chrome.clusterTop = 60;
    resize();
    expect(overlay.style.height).toBe('0px');
    expect(overlay.style.visibility).toBe('hidden');
    chrome.height = 1000;
    chrome.clusterTop = 750;
    rerender(<Rail rows={[{ height: 60 }]} chrome={chrome} />);
    expect(overlay.style.visibility).not.toBe('hidden');
    expect(overlay.style.height).toBe('300px');
  });

  it('reserves resized close-button bounds independently of cluster height', () => {
    const chrome: Chrome = { height: 1000, clusterTop: 700, closeBottom: 64 };
    const { getByTestId, container } = render(<Rail rows={[{ height: 2000 }]} chrome={chrome} />);
    const observer = latestResizeObserver()!;
    expect(observer.observe).toHaveBeenCalledWith(container.querySelector('.fs-close'));
    chrome.closeBottom = 220;
    resize();
    const overlay = getByTestId('overlay');
    expect(overlay.style.getPropertyValue('--lyrics-rail-top')).toBe('228px');
    expect(parseFloat(overlay.style.getPropertyValue('--lyrics-rail-top')) + parseFloat(overlay.style.height)).toBeLessThanOrEqual(692);
  });

  it('keeps observation stable across appearance/active-row renders and diffs added/removed rows', () => {
    const { getByTestId, rerender } = render(<Rail rows={[{ height: 60 }, { height: 60 }]} />);
    const observer = latestResizeObserver()!;
    const observed = observer.observe.mock.calls.length;
    rerender(<Rail active={1} rows={[{ height: 120 }, { height: 120 }]} />);
    expect(latestResizeObserver()).toBe(observer);
    expect(observer.observe).toHaveBeenCalledTimes(observed);
    expect(observer.disconnect).not.toHaveBeenCalled();
    rerender(<Rail active={1} rows={[{ height: 120 }, { height: 120 }, { height: 60 }]} />);
    expect(observer.observe).toHaveBeenCalledTimes(observed + 1);
    const removed = getByTestId('rail').lastElementChild;
    rerender(<Rail active={1} rows={[{ height: 120 }, { height: 120 }]} />);
    expect(observer.unobserve).toHaveBeenCalledWith(removed);
  });

  it('remeasures on ResizeObserver and viewport resize without a playback event', () => {
    const row = { top: 60, height: 60 };
    const { getByTestId } = render(<Rail rows={[row]} />);
    row.height = 300;
    resize();
    expect(parseFloat(getByTestId('overlay').style.height)).toBeCloseTo(302 / 0.6);
    expect(parseFloat(getByTestId('rail').style.transform.slice(11))).toBeCloseTo(302 / 0.6 / 2 - 60 - 150);
    row.height = 60;
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(2000);
    act(() => { window.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(20); });
    expect(getByTestId('overlay').style.height).toBe('600px');
    expect(getByTestId('rail').style.transform).toBe('translateY(210px)');
  });

  it('supports conditional mount and disconnects observers and resize listeners on removal', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { rerender } = render(<Rail rows={[]} visible={false} />);
    rerender(<Rail rows={[{ top: 0, height: 60 }]} />);
    const observer = latestResizeObserver()!;
    rerender(<Rail rows={[]} visible={false} />);
    expect(observer.disconnect).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('coalesces resize work and cancels queued measurement when a loading branch removes the rail', () => {
    const { getByTestId, rerender } = render(<Rail rows={[{ height: 60 }]} />);
    const overlay = getByTestId('overlay');
    const set = vi.spyOn(overlay.style, 'setProperty');
    const observer = latestResizeObserver()!;
    act(() => { observer.emit(); observer.emit(); window.dispatchEvent(new Event('resize')); });
    rerender(<Rail rows={[]} visible={false} />);
    act(() => { vi.advanceTimersByTime(20); observer.emit(); vi.advanceTimersByTime(20); });
    expect(set).not.toHaveBeenCalled();
    expect(observer.disconnect).toHaveBeenCalled();
  });
});
