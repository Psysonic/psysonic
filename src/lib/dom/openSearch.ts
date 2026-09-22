export const OPEN_SEARCH_EVENT = 'psy:open-search';

export function requestOpenSearch(): boolean {
  const event = new Event(OPEN_SEARCH_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
