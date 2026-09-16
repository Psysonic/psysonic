import { beforeEach, describe, expect, it } from 'vitest';
import { useBurnRecorderStore } from '@/features/burner/store/burnRecorderStore';

beforeEach(() => {
  useBurnRecorderStore.getState().select('');
});

describe('burn recorder selection', () => {
  it('starts with nothing chosen', () => {
    expect(useBurnRecorderStore.getState().selectedId).toBe('');
  });

  it('keeps the chosen drive for whoever asks next', () => {
    // The page mounting and unmounting is exactly that: the drive picker asks
    // again on the way back, and must get the same answer.
    useBurnRecorderStore.getState().select('imapi:second-drive');
    expect(useBurnRecorderStore.getState().selectedId).toBe('imapi:second-drive');
  });
});
