# What's New

User-facing release highlights for the in-app **What's New** screen. Maintainers refresh the
current line before promoting to `next` / `release`. Technical details and PR credits stay in
`CHANGELOG.md`.

Within each section, order by **user impact** (most noticeable first) — not PR merge order.
`CHANGELOG.md` keeps strict PR order inside Added / Changed / Fixed.


## [1.56.0]

## Highlights

### Device Sync — more formats and destinations

- **Device Sync → Format** can store MP3, AAC, or Opus copies at a chosen maximum bitrate instead of the original files, when your server supports transcoding to that format. Changing the format or bitrate replaces the copies on the next sync; existing devices keep their originals until you choose another format.
- Sync to an empty folder on this computer's disk, for example to bring playlists into DJ software. Psysonic asks before using the folder and leaves files it did not create alone.
- Moving tracks within a playlist or changing its layout now moves existing copies rather than downloading them again. Tracks removed from synced playlists or sources are removed from the device.
- **M3U path style → Absolute** writes full paths into playlists for players that cannot resolve relative ones. These paths work only while the device keeps the same drive letter or mount point.

### Browse albums by mood

- The new **Moods** page groups the mood tags in your tracks, letting you browse albums by mood across your selected libraries. Album counts and incremental loading help with larger collections.
- Existing libraries build the mood index from cached track information after updating. Nothing is changed in your music files; if your server does not expose track moods, there are no moods to browse.

### Full Bandcamp support

- Psysonic now fully supports Bandcamp through its Subsonic API. **Waveforms, loudness normalization and measured BPM** close the remaining gap in playback analysis.
- Loudness adjusts while a song downloads, then receives its final correction. Analysis of Bandcamp's MP3 streams is cached and reused for repeat playback, with the existing checks for changed content.

### Discover music with AudioMuse

- The album page can show **Similar albums** that sound like the open album, excluding albums by the same artist.
- **Settings → Personalisation → Home** can use AudioMuse for the **Because you listened** row, retitled **If you like the sound of …** when selected. Similar artists remain the default.
- Both options need Navidrome 0.62 or newer with the AudioMuse plugin. The album row stays hidden when unavailable; the Home setting is offered only when a compatible server is detected.

### Choose how a click plays a track

- **Settings → Input → Mouse** lets you play a song in a list with a single or double click, helping prevent an accidental click from replacing what's playing. The row's play button still works with one click.
- Click or use the arrow keys to highlight a row, then press Enter to play it. Ctrl can add highlighted rows to a selection; Escape clears it. The Tracks page and search results follow the same click setting.

### More detail in your album and track lists

- Navidrome track subtitles such as “Instrumental” appear after song titles, and album versions such as “Deluxe Edition” appear with album names, including libraries synced through Navidrome's own API. Existing libraries refresh this information in the background.
- The album page also shows the version below the title when the title does not already contain it.
- **All Albums** and **Lossless Albums** can be sorted by **Year**, newest or oldest first. In table view, click the Year column heading to switch direction.

## Fixed

### Playback and audio

- **Windows:** Seeking during the first play of a streamed track could leave audio silent or snap the position back. The seek now completes where you clicked, including for streamed FLAC and MP3 tracks.
- With **Gapless Playback** enabled, tracks with different sample rates, such as 44.1 and 48 kHz, keep the correct speed when played one after another, including after audio-device recovery.

### Linux AppImage

- **Linux AppImage:** On Fedora 44 and similar systems, the app starts using the system's WebKitGTK when available instead of a bundled copy that can crash at launch. It still uses the bundled copy if the system has none, and `PSYSONIC_FORCE_BUNDLED_WEBKIT=1` opts back into it.
- **Linux AppImage:** AAC internet radio works when using the system WebKitGTK and its media plugins. Missing system plugins still fall back to the bundled ones.

### Playlists and queue

- **Playlists:** Navidrome smart playlists keep their own covers on the Playlists page. Server playlists show tracks when several libraries or **All libraries** are selected, and changing the library view no longer removes offline pins for hidden tracks.
- **Queue:** The queue shuffle button now switches shuffle on and off for upcoming tracks, restoring their original order when turned off. Played tracks are dimmed in the queue panel's Playlist view.

### Other

- **Track lists:** On macOS and Linux, the mouse wheel scrolls vertically again after a sideways swipe through a track list.
- **Player commands:** Command-line controls such as `--player play`, `pause`, and `next` work again. Playing a song by ID starts it even when it is not in the queue.
