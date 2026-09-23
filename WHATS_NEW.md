# What's New

User-facing release highlights for the in-app **What's New** screen. Maintainers refresh the
current line before promoting to `next` / `release`. Technical details and PR credits stay in
`CHANGELOG.md`.

Within each section, order by **user impact** (most noticeable first) — not PR merge order.
`CHANGELOG.md` keeps strict PR order inside Added / Changed / Fixed.


## [1.55.0]

## Highlights

### Burn audio CDs from your library

- The new **CD Burner** page writes albums, playlists, tracks, or a custom running order to a Red Book audio CD on Windows, macOS, and Linux.
- Choose gapless playback or the usual two-second gaps, add CD-TEXT, and optionally match levels across tracks. Music that is not downloaded yet is fetched for the burn without changing your Offline Library.
- **Rehearse** checks the whole job with the laser off, and a completed disc is read back for verification instead of relying only on the drive's report.

### Favorites — search, arrange, and browse at scale

- Search now covers favourite artists, albums, radio stations, top artists, and songs together, with expandable results on the same page.
- **Settings → Personalisation → Favorites page sections** can reorder or hide sections. The song list can hide its **#** column, and **Shuffle all** respects filters and selections.
- The **Albums** and **Artists** headings open their full browse pages with the favourites filter already applied, so large collections keep their normal grids, sorting, and view controls.

### Navidrome shares inside Psysonic

- Enable sharing under **Settings → Integrations → Navidrome**, then create public links from tracks, albums, artists, playlists, composers, or the play queue without opening the server website.
- The new **ND Shares** page gathers links from the selected servers with artwork and item details. Preview or play a share, add it to the queue, copy or open its link, and remove it from the server.
- Pasted and searched share links open the same preview flow, while share creation now copies links reliably through the desktop clipboard.

### Queue — select and move several tracks at once

- Ctrl+click (Command on macOS) selects individual tracks, Shift+click selects a range, and Delete removes the selection. Ctrl+Z restores it.
- Drag one selected track to move the whole selection together. Holding tracks at the top or bottom edge scrolls long queues automatically, including in the mini player.
- Right-click **Clear** to remove queue history and upcoming tracks without interrupting the current song.

### Device Sync — every track in one folder

- **Device Sync → Layout → All files in one folder** puts music directly in the device's main folder for players that cannot browse directories.
- Predictable filenames keep tracks distinct, while `.m3u8` playlists point to the same files instead of storing duplicates. When an existing device switches to this layout, old folder copies are removed after the new files are in place.

### More album and track metadata

- Album pages show server descriptions and consistent comment tags such as remaster notes, with long descriptions expandable in place.
- **Song Info** shows every genre and mood stored in a file. Optional **Genres** and **Mood** tracklist columns expose the same tags while staying off until selected.

### Preview the visualizer while configuring it

- **Settings → Appearance → Visualizer** now shows the active visualizer above its controls, so colours, sensitivity, responsiveness, peak caps, and frame rate can be judged immediately.
- It follows current playback, or uses a short built-in demo signal when nothing is playing.

### Word-synced lyrics — continuous flow without the full-word glow

- **Settings → Lyrics → Word highlighting → Flow only** keeps the continuous colour fill while removing the instant glow around the whole active word. **Step** remains the default, and **Smooth** is unchanged.

## Improved

- Starting an album, playlist, or favourites list while shuffle is enabled now queues that list in random order from the track you chose. Turning shuffle off restores its original order.
- **Settings → Integrations → Navidrome → Play queue sync** can keep the queue local to this device without affecting playback. The related **Allow downloads** option now appears only when sharing is enabled.
- Artist pages fall back to similar artists supplied by the server when the selected Music Network service has no matches in your library.
- The fullscreen style picker now points directly to the separate switch that controls the artist photo backdrop.

## Fixed

### Playback and audio

- Seeking and rapid scrubbing through streamed lossless tracks no longer freeze playback or allow an older seek to overwrite the final position.
- Waveform and loudness analysis now persist on compatible Subsonic servers beyond Navidrome, after Psysonic verifies that the downloaded audio is the original file.
- Fast seeks no longer flash the buffering spinner over cover art when audio is already ready.

### Queue, lyrics, and search

- Dropping a track only moves it instead of also starting playback, and tracks moved down the queue land exactly where the insertion line shows.
- Tracks under **Artist → Top** can be dragged to the queue just like tracks under **All**.
- Fullscreen lyrics no longer cover track details in **Minimal** mode or remain visible through the cover and title in **Immersive** mode.
- The search shortcut opens a collapsed desktop or mobile search field before focusing it, so typing is always visible.

### Browse and library

- Favourite artist filters now include every credited role and update with the active server group. Tracklists also use analysed BPM when the file has no BPM tag.
- **Add to Playlist** shows editable Navidrome playlists again when native smart-playlist metadata is unavailable, while smart playlists remain read-only.
- Guest performers, orchestras, choirs, and other participant-only artists open correctly from track credits within the selected library scope.
- Separate Navidrome libraries can contain tracks at the same relative path without colliding during background sync.
- Background sync no longer aborts with duplicate artist-credit keys while assigning music folders.
- Navidrome canonical-ID migrations recover after an interrupted reload, and their startup progress screen keeps its layout and styling in packaged builds.
- In a multi-server group, capability and version changes are refreshed for every reachable server, including inactive ones.

### Backups and Device Sync

- Backups now restore all stored settings, including page layouts, columns, radio favourites, playlist folders, installed themes, and player-bar preferences. Older backups do not clear settings they never contained.
- Device Sync selections and layout survive backup and restore, while the machine-specific target device deliberately stays unassigned until you choose it again.
- **Settings → Backup & Restore** now warns beside the relevant export buttons that settings backups contain server passwords and scrobbler keys in readable form.

### Themes and integrations

- Apple Music and Last.fm artwork fallbacks no longer replace covers already supplied by your server. Existing incorrect fallback covers are removed after updating, and external fallbacks now start disabled.
- The artist-page Last.fm button always opens Last.fm, and its hover highlight is no longer clipped at the edge.

### Other

- Multi-artist separators are centred and spaced consistently in track rows and album headers.
- **macOS:** dropdowns, player-bar buttons, the Orbit label, and rating stars remain steady and correctly sized while hovering or using JetBrains Mono.
- The login logo can no longer be dragged away, and long server names wrap correctly in the cover cache table.
