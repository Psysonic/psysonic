/**
 * Library index writes run one after another, in the order they were issued.
 *
 * The Rust commands behind them run on a blocking pool, so two writes in flight
 * at once could land in either order: a quick star → unstar, or the two patches
 * of one scrobble, would leave the older value behind. Chaining here keeps the
 * order the main thread used to give these writes when they were sync commands.
 */
let tail: Promise<unknown> = Promise.resolve();

export function enqueueLibraryWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = tail.then(write);
  tail = result.catch(() => undefined);
  return result;
}
