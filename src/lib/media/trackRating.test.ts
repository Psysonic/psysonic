import { describe, expect, it } from 'vitest';
import { multiTrackRatingId, unifiedTrackRating } from './trackRating';

describe('unifiedTrackRating', () => {
  it('reports the shared rating when every track agrees', () => {
    const tracks = [
      { id: 'a', serverId: 'srv', userRating: 4 },
      { id: 'b', serverId: 'srv', userRating: 4 },
    ];
    expect(unifiedTrackRating(tracks, {})).toBe(4);
  });

  it('reports no rating when the tracks disagree', () => {
    const tracks = [
      { id: 'a', serverId: 'srv', userRating: 4 },
      { id: 'b', serverId: 'srv', userRating: 2 },
    ];
    expect(unifiedTrackRating(tracks, {})).toBe(0);
  });

  it('prefers a pending override over the value the server sent', () => {
    const tracks = [
      { id: 'a', serverId: 'srv', userRating: 1 },
      { id: 'b', serverId: 'srv', userRating: 1 },
    ];
    expect(unifiedTrackRating(tracks, { 'srv:a': 5, 'srv:b': 5 })).toBe(5);
  });

  it('falls back to the unscoped override key', () => {
    const tracks = [{ id: 'a', userRating: 0 }];
    expect(unifiedTrackRating(tracks, { a: 3 })).toBe(3);
  });

  it('treats an unrated track as zero rather than undefined', () => {
    expect(unifiedTrackRating([{ id: 'a' }, { id: 'b' }], {})).toBe(0);
  });

  it('reports no rating for an empty selection', () => {
    expect(unifiedTrackRating([], {})).toBe(0);
  });
});

describe('multiTrackRatingId', () => {
  it('does not depend on the order the rows were picked in', () => {
    const forward = multiTrackRatingId([{ id: 'a' }, { id: 'b' }]);
    const reverse = multiTrackRatingId([{ id: 'b' }, { id: 'a' }]);
    expect(forward).toBe(reverse);
  });

  it('separates ids with a character that cannot appear inside one', () => {
    expect(multiTrackRatingId([{ id: 'a' }, { id: 'b' }])).toBe('a\x1eb');
  });
});
