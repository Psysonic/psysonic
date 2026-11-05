import { useThemeStore } from '@/store/themeStore';

/** True when the element or anything inside it cuts its content off. */
export function clipsContent(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth + 1) return true;
  return Array.from(el.querySelectorAll<HTMLElement>('*'))
    .some(node => node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1);
}

/**
 * Tooltip of a control inside a table cell that has a hint of its own ("click
 * to …"). The tooltip portal picks the innermost anchor, so that hint would
 * hide the cell's full-text tooltip: when the control cuts its text off, the
 * full text goes on the first line. Same switch as the cells' full-text
 * tooltips. Call it on mouse enter; the portal reads the text when it opens.
 */
export function setHintTooltip(el: HTMLElement, hint: string, fullText: string | undefined): void {
  if (fullText && useThemeStore.getState().showCardTooltips && clipsContent(el)) {
    el.setAttribute('data-tooltip', `${fullText}\n${hint}`);
    el.setAttribute('data-tooltip-wrap', '');
  } else {
    el.setAttribute('data-tooltip', hint);
    el.removeAttribute('data-tooltip-wrap');
  }
}
