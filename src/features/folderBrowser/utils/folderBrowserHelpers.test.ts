import { describe, expect, it } from 'vitest';
import type { LibraryTrackDto } from '@/lib/api/library/dto';
import type { SubsonicDirectoryEntry } from '@/lib/api/subsonicTypes';
import { entryToTrack, trackDtoToFolderEntry } from '@/features/folderBrowser/utils/folderBrowserHelpers';

function makeTrackDto(overrides: Partial<LibraryTrackDto> = {}): LibraryTrackDto {
  return {
    serverId: 'srv-a',
    id: 'track-1',
    title: 'Collab',
    artist: 'Alice, Bob',
    artistId: 'ar-1',
    album: 'Album',
    albumId: 'al-1',
    durationSec: 180,
    syncedAt: 1,
    rawJson: {},
    ...overrides,
  };
}

describe('folderBrowserHelpers — structured artist preservation', () => {
  it('preserves coerced OpenSubsonic artists from LibraryTrackDto.rawJson', () => {
    const entry = trackDtoToFolderEntry(
      makeTrackDto({
        rawJson: {
          artists: [
            { id: ' a1 ', name: ' Alice ' },
            { id: 'a2', name: ' Bob' },
          ],
        },
      }),
    );

    expect(entry.artists).toEqual([
      { id: 'a1', name: 'Alice' },
      { id: 'a2', name: 'Bob' },
    ]);

    const track = entryToTrack(entry);
    expect(track.artists).toEqual([
      { id: 'a1', name: 'Alice' },
      { id: 'a2', name: 'Bob' },
    ]);
  });

  it('omits artists when absent on LibraryTrackDto.rawJson and SubsonicDirectoryEntry', () => {
    const entry = trackDtoToFolderEntry(makeTrackDto({ rawJson: {} }));
    expect('artists' in entry).toBe(false);

    const plainEntry: SubsonicDirectoryEntry = {
      id: 'track-2',
      title: 'Solo',
      artist: 'Solo Artist',
      isDir: false,
    };
    const track = entryToTrack(plainEntry);
    expect('artists' in track).toBe(false);
  });
});
