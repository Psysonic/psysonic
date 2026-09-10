# What's New

User-facing release highlights for the in-app **What's New** screen. Maintainers refresh the
current line before promoting to `next` / `release`. Technical details and PR credits stay in
`CHANGELOG.md`.

Within each section, order by **user impact** (most noticeable first) — not PR merge order.
`CHANGELOG.md` keeps strict PR order inside Added / Changed / Fixed.


## [1.53.0]

## Highlights

### Native smart playlists — build dynamic playlists in Psysonic

- Navidrome smart playlists now appear with a sparkle marker and keep their server-evaluated tracks read-only.
- Create and edit native rules in Basic, Advanced, or lossless JSON mode, preview matching tracks, and refresh the results from the Playlists page.
- Availability follows the connected Navidrome version, with a warning when the server cannot keep part of a rule.

### Reliable scrobbling — plays wait until services recover

- Plays that cannot reach a Music Network service are kept for up to 14 days and sent automatically when the connection or login recovers.
- Pending plays survive restarts, and each destination under **Settings → Integrations** shows how many are still waiting.

### Safer desktop updates — install the right build with confidence

- **Windows:** the update dialog now downloads, verifies, and installs signed updates inside the app, then restarts Psysonic automatically.
- Supported Flatpak installs now use signed Psysonic repositories with separate stable and release-candidate channels.
- The Flatpak update dialog follows the installed channel and shows the exact update command.

### Psysonic Rewind — turn your year into a story

- Open **Statistics → Psysonic Rewind** to explore your year in music and export overview, artist, album, or nerd-stats posters.
- Choose story or square layouts in a dedicated dark poster style with a live preview.
- Everything is generated locally from your own play history; your listening data stays on your device.

### Device Sync — reuse tracks across playlists

- Albums and playlists on a portable device now share one physical copy of each song instead of duplicating it inside every playlist folder.
- Existing layouts migrate on the next sync, with recovery support if the device is disconnected before the migration finishes.

### Album artwork — choose where missing covers come from

- **Settings → Integrations → Album artwork** lets you enable and reorder the server, Apple Music, and Last.fm as fallback sources.
- The first enabled source that finds a cover wins.

### Follow the desktop theme on Linux

- Psysonic can follow desktop colour files such as Omarchy's and update its theme within seconds when the desktop theme changes.
- The generated theme appears under **Settings → Themes**, with a **Follow desktop theme** switch that stays off for existing installs until enabled.

### Ratings and queue controls — act without leaving the list

- Assign 1–5 stars to the current track with optional global shortcuts under **Settings → Input**.
- Select several tracks in an album, Favourites, or a playlist to rate, favourite, queue, or add all of them at once.
- Queue rows now include an optional heart for favouriting a track directly.

### Windows mini player — choose a slimmer frame

- **Settings → Appearance** can remove the Windows system title bar from the mini player and replace it with Psysonic's compact draggable bar.
- The option is off by default, applies immediately, and leaves macOS and Linux behaviour unchanged.

## Improved

- Subsonic servers that work normally but reject browser-style requests can now be added without failing with a network error.
- The Artists page remembers whether you prefer grid or list view, including after restarting Psysonic.
- The optional tour-dates prompt in the info tab can be dismissed permanently and restored later from **Settings → Integrations**.

## Fixed

### Playback and audio

- **Linux:** PipeWire playback no longer crackles, drops out, or floods the log with buffer underruns.
- Resuming after a long pause no longer moves the Now Playing display ahead while the current track is still playing.
- Unfocused visualizers pause in the background by default and resume when Psysonic regains focus.

### Browse and library

- Navidrome libraries keep ISRC and MusicBrainz recording IDs again, and existing libraries receive them through a one-time background repair.
- Library rebuilds remove albums and tracks that were deleted from Navidrome instead of leaving ghost entries.
- Albums recover release years and dates from servers that report them differently, restoring recently-added and New Releases results.
- Multi-disc album subtitles from OpenSubsonic appear on Album Detail again.
- Album pages stay visible while library sync refreshes them in the background.
- Long playlist pages return to the previous scroll position, and the owner filter now fits beside the sort control.
- Play count and last played values update on the list where playback started instead of waiting for a page reload.
- Ratings set from a context menu stay visible, and recommendation cards no longer collapse at narrow widths.
- Lyrics edited or added on the server can be reloaded from the lyrics pane.

### Other

- Shared Top Albums and New Albums images show their cover art again.
- Update dialog buttons wrap instead of running outside the dialog in languages with longer labels.
