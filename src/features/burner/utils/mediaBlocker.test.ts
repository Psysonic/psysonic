import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import type { BurnMediaBlocker } from '@/lib/api/burn';
import { describeMediaBlocker } from '@/features/burner/utils/mediaBlocker';

const ALL: BurnMediaBlocker[] = [
  'noDisc',
  'notCd',
  'alreadyWritten',
  'notBlankRewritable',
  'notBlankRecordable',
  'driveRefusedDisc',
  'driveSilent',
];

describe('describeMediaBlocker', () => {
  it('says nothing about a disc that can be burned', () => {
    expect(describeMediaBlocker(null, 'CD-R')).toBeNull();
    expect(describeMediaBlocker(undefined, 'CD-R')).toBeNull();
  });

  it('gives every blocker its own translated sentence', () => {
    const texts = ALL.map(blocker => {
      const described = describeMediaBlocker(blocker, 'DVD-R');
      expect(described, blocker).not.toBeNull();
      return i18n.t(described!.key, described!.values);
    });

    // A key that resolved to itself is a key with no string behind it.
    texts.forEach((text, index) => {
      expect(text, ALL[index]).not.toContain('burner.mediaBlocker');
      expect(text.length, ALL[index]).toBeGreaterThan(0);
    });
    expect(new Set(texts).size, 'each blocker reads differently').toBe(ALL.length);
  });

  it('names the media type, and only where the sentence asks for one', () => {
    const notCd = describeMediaBlocker('notCd', 'DVD-R');
    expect(notCd?.values).toEqual({ mediaType: 'DVD-R' });
    expect(i18n.t(notCd!.key, notCd!.values)).toContain('DVD-R');

    expect(describeMediaBlocker('noDisc', 'DVD-R')?.values).toBeUndefined();
  });

  it('still blocks the burn when the drive reports something this build cannot name', () => {
    // A newer backend, an older page: the disc is unusable either way.
    const unknown = describeMediaBlocker('somethingNew' as BurnMediaBlocker, 'CD-R');
    expect(unknown).not.toBeNull();
    expect(i18n.t(unknown!.key)).not.toContain('burner.mediaBlocker');
  });
});
