import { describe, expect, it } from 'vitest';
import type { NavidromeCanonicalMigrationServerCheckpointV1 as Checkpoint } from './navidromeCanonicalCheckpoint';
import { checkpointHasCanonicalNamespace, checkpointIsFalseNonNavidromeBlock } from './navidromeCanonicalNamespace';

function entry(patch: Partial<Checkpoint> = {}): Checkpoint {
  return {
    sourceVersion: '2.8.0', checkedVersion: '2.8.0', canonicalVersion: 1,
    phase: 'blocked', step: null, cursorRowid: 0, upperRowid: 0, cursorKey: null, upperKey: null,
    startedAt: 1, updatedAt: 2, localCompletedAt: null, syncCompletedAt: null,
    lastError: 'Navidrome canonical ID namespace for music.test cannot be downgraded after 2.8.0',
    ...patch,
  };
}

describe('canonical namespace provenance', () => {
  it.each(['not-applicable', 'legacy', 'retryable'] as const)('a %s raw version alone is not namespace proof', phase => {
    expect(checkpointHasCanonicalNamespace(entry({ phase, lastError: null }))).toBe(false);
  });

  it.each(['pending', 'native', 'analysis', 'cover', 'frontend', 'cleanup', 'sync', 'ready', 'blocked'] as const)(
    'retains previously checked canonical evidence in %s', phase => {
      expect(checkpointHasCanonicalNamespace(entry({ phase, checkedVersion: '0.64.0' }))).toBe(true);
    },
  );

  it.each([null, 'custom-build', '0.63.2'])('does not infer canonical provenance from %s', checkedVersion => {
    expect(checkpointHasCanonicalNamespace(entry({ checkedVersion }))).toBe(false);
  });

  it('the format version on its own never proves canonical IDs', () => {
    expect(checkpointHasCanonicalNamespace(entry({ phase: 'ready', checkedVersion: null }))).toBe(false);
    expect(checkpointHasCanonicalNamespace(undefined)).toBe(false);
  });

  it.each([
    { step: 'backup-import' }, { cursorRowid: 1 }, { upperRowid: 1 },
    { cursorKey: 'cover' }, { upperKey: 'cover' },
    { localCompletedAt: 0 }, { syncCompletedAt: 0 },
  ])('retains evidence despite a terminal non-canonical label and work markers %j', patch => {
    expect(checkpointHasCanonicalNamespace(entry({ phase: 'not-applicable', ...patch }))).toBe(true);
  });

  it('only the explicit non-Navidrome, same-version, pre-work false gate is recoverable', () => {
    expect(checkpointIsFalseNonNavidromeBlock('music.test', entry(), {
      type: ' Any non-Navidrome implementation ', serverVersion: '2.8.0',
    })).toBe(true);
  });

  it.each([
    {}, { type: null }, { type: '' }, { type: ' ' }, { type: 'unknown', serverVersion: '2.8.0' },
    { type: 'navidrome' }, { type: ' NAVIDROME ' },
    { type: 'Other', serverVersion: '2.8.1' }, { type: 'Other', serverVersion: null },
  ])('rejects unproven current identity/version %j', ping => {
    expect(checkpointIsFalseNonNavidromeBlock('music.test', entry(), ping)).toBe(false);
  });

  it.each([
    { phase: 'ready' }, { phase: 'pending' }, { sourceVersion: null }, { sourceVersion: '0.64.0' },
    { checkedVersion: null }, { checkedVersion: 'custom-build' }, { lastError: null },
    { lastError: 'Navidrome canonical ID namespace for other.test cannot be downgraded after 2.8.0' },
    { step: 'artist' }, { cursorRowid: 1 }, { upperRowid: 1 },
    { cursorKey: 'cover' }, { upperKey: 'cover' }, { localCompletedAt: 0 }, { syncCompletedAt: 0 },
  ] satisfies Array<Partial<Checkpoint>>)('rejects ambiguous historical provenance %j', patch => {
    expect(checkpointIsFalseNonNavidromeBlock('music.test', entry(patch), {
      type: 'Other', serverVersion: '2.8.0',
    })).toBe(false);
  });
});
