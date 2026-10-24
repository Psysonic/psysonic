import { describe, expect, it } from 'vitest';
import { enqueueLibraryWrite } from './writeQueue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('enqueueLibraryWrite', () => {
  it('starts a write only after the one before it settled', async () => {
    const first = deferred();
    const started: string[] = [];
    const a = enqueueLibraryWrite(() => {
      started.push('star');
      return first.promise;
    });
    const b = enqueueLibraryWrite(async () => {
      started.push('unstar');
    });

    await settle();
    expect(started).toEqual(['star']);

    first.resolve();
    await Promise.all([a, b]);
    expect(started).toEqual(['star', 'unstar']);
  });

  it('keeps going after a failed write and hands each caller its own outcome', async () => {
    const failed = enqueueLibraryWrite(() => Promise.reject(new Error('database is locked')));
    const next = enqueueLibraryWrite(() => Promise.resolve(7));

    await expect(failed).rejects.toThrow('database is locked');
    await expect(next).resolves.toBe(7);
  });
});
