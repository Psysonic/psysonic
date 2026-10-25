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

### Continue listening where you left off

- Albums and playlists gain a **Resume** button with the song and position where you stopped. **Continue listening** on Home brings these lists together with their progress.
- Progress is remembered after at least one song plays to the end, and cleared when you finish the list. Lists started in shuffle or private mode are not remembered.

### Private mode — listen without sharing or recording

- The mask button in the top bar turns off scrobbles, server play counts and now-playing reports, Discord activity, Statistics, Rewind and play history while you listen privately.
- It applies immediately, including to the current song, and is always off when Psysonic starts.

### Smart shuffle — more variety between songs

- Shuffle spreads songs by the same artist and from the same album over the list, avoiding consecutive songs by one artist whenever the queue allows it. Shuffle-play actions across the library use the same behaviour.
- **Settings → Personalisation → Queue Settings → Smart shuffle** is on by default. Turn it off to keep purely random ordering. Radio, Instant Mix and the infinite queue are unchanged.

### Browse by label, mood or genre

- **Labels** lists your record labels with album counts, filtering and a letter jump bar. Turn it on under **Settings → Personalisation → Sidebar**, or follow the label link on an album page. Existing libraries build the label index once after updating, with progress shown.
- **Moods** groups the mood tags exposed by your server, including Navidrome's native metadata. Open a mood to browse its **Albums** or **Tracks** across the selected libraries. Existing tracks are indexed after updating without changing music files; servers without mood tags have none to browse.
- **Genres** and **Moods** gain search and popularity or alphabetical sorting. Returning from a detail page restores your search and scroll position.

### Bandcamp — waveform, loudness and BPM analysis

- Bandcamp playback now includes **waveforms, loudness normalization and measured BPM** through its Subsonic API.
- Loudness adjusts while a song downloads, then receives its final correction. Analysis uses the MP3 stream exposed by Bandcamp's API and is cached for repeat playback; it does not require the uploaded lossless original.

### Discover music with AudioMuse

- The album page can show **Similar albums** that sound like the open album, excluding albums by the same artist.
- **Settings → Personalisation → Home** can use AudioMuse for the **Because you listened** row, retitled **If you like the sound of …** when selected. Similar artists remain the default.
- Both options need Navidrome 0.62 or newer with the AudioMuse plugin. The album row stays hidden when unavailable; the Home setting is offered only when a compatible server is detected.

### Lyrics translations from your server

- Show a translation below each lyric line in the sidebar, narrow-window view and fullscreen player. Use **Settings → Lyrics → Translation**, or the **Translation** button shown for songs that have one.
- Requires **Navidrome 0.63 or newer** and lyrics containing translations, such as TTML. When several translations are available, Psysonic uses the one matching your app language.

### Organise and reach your playlists

- Right-click playlists to add **Tags**, then filter the Playlists page with tag chips. Selecting several tags shows playlists carrying all of them. Tags are stored on this device and included in settings backups.
- **Add to playlist** menus put the three recently used playlists first when you have at least six playlists, followed by the alphabetical list.
- Web links in playlist descriptions open in your browser.

### More ways to control playback

- The sleep timer can stop at **End of track** or **End of album**, with the time left shown at the play button. It pauses just before the end so the next song does not start; pressing Play continues from there.
- Alt+click (Option+click on macOS) on Next or Previous skips a whole album in the player bar, fullscreen player and mini player. **Next album** and **Previous album** can also be assigned local or global keyboard shortcuts.
- Optional **Settings → System → App Behavior → Notifications → Notify on Track Change** announces new songs when Psysonic is not the active window, including internet radio titles. It is off by default and not yet available in Flatpak.

### Click, swipe and zoom

- **Settings → Input → Mouse** lets you play a song in a list with a single or double click, helping prevent an accidental click from replacing what's playing. The row's play button still works with one click.
- Click or use the arrow keys to highlight a row, then press Enter to play it. Ctrl can add highlighted rows to a selection; Escape clears it. The Tracks page and search results follow the same click setting.
- Swipe left or right with two fingers on a touchpad to go back or forward without interrupting sideways scrolling in lists. **Settings → Input → Touchpad** can turn navigation gestures off.
- In the full-size cover view, pinch or use Ctrl/⌘ + scroll to zoom around the pointer, then drag to move. Double-click zooms in or out; +/−, the arrow keys and 0 provide keyboard controls.

### Personalise Home and the fullscreen player

- Drag Home's rows into your preferred order under **Settings → Personalisation → Home**. The large banner keeps its place.
- **Settings → Appearance → Fullscreen player → Open automatically** can open the player after 1–30 minutes without input while a song plays and the window is on screen. It is off by default and excludes radio; the next mouse or keyboard input closes it without activating anything underneath.

### More detail in your album and track lists

- Navidrome track subtitles such as “Instrumental” appear after song titles, and album versions such as “Deluxe Edition” appear with album names, including libraries synced through Navidrome's own API. Existing libraries refresh this information in the background.
- The album page also shows the version below the title when the title does not already contain it.
- Songs your server marks as explicit gain an **E** badge. Optional **Blur explicit covers** softly hides their artwork; opening an album cover still shows it in full. Both options are under **Settings → Appearance → Visual Options** and require server-provided explicit tags.
- **Settings → Library → Ratings → Show star ratings** can hide rating controls, the rating column and highest-rated rows when you do not use them.

### Find settings and sort albums more easily

- Settings search now covers every option, its choices and hints, tolerates small typos and recognises English terms in every UI language. Selecting a result opens and highlights the matching option.
- Open Settings with **⌘,** on macOS or **Ctrl+,** on Windows and Linux. Existing shortcut assignments keep priority, and the shortcut can be changed under **Settings → Input → Keyboard shortcuts**.
- **All Albums** and **Lossless Albums** can be sorted by **Year**, newest or oldest first, including through the Year column heading. Artist pages also offer album-name sorting, with natural number order such as “Live 2” before “Live 10”.

## Improved

- Album, artist and playlist cards, and playlists in the sidebar, mark what is playing. Markers stay still on Linux, while paused or with reduced motion enabled.
- **Greek (Ελληνικά)** is available on the Settings and Login language pickers. Library matching recognises Greek accent and letter variants; library keys rebuild once after updating.
- Starting playback with Psysonic's volume at zero shows a short reminder without repeating it for every automatic track change.
- Ukrainian translations are more complete, and Polish, Romanian and Greek labels have wording corrections.

## Fixed

### Playback and audio

- Streaming no longer keeps a CPU core busy throughout a song, fixing the excess decoder load introduced in 1.55.
- Seeking during the first play of a streamed track no longer leaves audio silent or snaps the position back. Seeking after an automatic gapless transition also avoids an unnecessary reload and buffering stall.
- With **Gapless Playback** enabled, tracks with different sample rates keep the correct speed, including after audio-device recovery. Repeating one song or playing consecutive copies of it now stays gapless too.
- Playback resumes from its saved position after a long pause, including when the audio device was released while idle. Recovery no longer silently restarts the song from the beginning.
- **Linux:** With Native Hi-Res Playback off, PipeWire playback follows the system output rate instead of forcing 44.1 kHz.
- The sleep timer keeps running across song changes when gapless playback is off. System media controls keep the correct song after rapid skips.

### Offline, Now Playing, and Navidrome

- Navidrome upgrades recover from conflicting local-download records and stale track aliases instead of repeatedly stopping at migration errors, preserving history, ratings and offline copies.
- Offline playlists correctly own tracks already downloaded through an album, so removing that album's offline copy does not remove the playlist's tracks. The playlist page shows download progress and lets you remove its offline copy.
- Playlists show their tracks with several libraries or **All libraries** selected. Changing the visible library scope no longer removes offline pins for hidden tracks.
- With **Play queue sync** off, the queue and current track survive a restart instead of being replaced by an older server queue.
- With **Navidrome 0.62 or newer**, Live shows playback from your other devices even while this Psysonic is idle.
- Navidrome smart playlists keep their own covers on the Playlists page, and uploaded artist images appear immediately in the round picture, header and About section.

### Themes and integrations

- **Orbit:** Guests' **Add to queue**, **Play next** and **Play All** actions reach the host as suggestions instead of disappearing on the next host update. Search shows only the suggestion confirmation, and join failures explain the reason in the app language.
- **Settings → Integrations → External Artwork Scraper → Backgrounds** stays available with the scraper off, so the server's artist image can still be switched off in page and player backgrounds.

### Browse and library

- The app remains responsive while long library writes are in progress instead of blocking other work and parts of window setup.
- Originals and reissues with the same artist and title but different years remain separate albums within one library. The source picker no longer offers duplicate entries from that same library.
- Mood tags survive unrelated metadata updates, and ambiguous cached entries are checked against the server when it is available and playback is idle.
- Device Sync keeps Navidrome albums under their album artist, separates multi-disc filenames and skips remaining filename collisions with a count in the summary. Its page scrolls and remains usable in small windows.
- The queue shuffle button switches upcoming tracks between shuffled and original order; played tracks are dimmed in Playlist view.
- **macOS and Linux:** The mouse wheel scrolls vertically again after a sideways swipe through a track list.

### Other

- Connections, library sync, covers and streaming no longer fail because requests unexpectedly use the system proxy. Connection errors now explain the cause, and login tokens are removed from errors and logs, including previously saved sync errors.
- **Linux AppImage:** On Fedora 44 and similar systems, the app uses the system's WebKitGTK when available to avoid a launch crash, with bundled WebKitGTK retained as a fallback. AAC radio uses available system media plugins, and launch files work under another user or in a sandbox.
- **Linux Flatpak:** A second launch reaches the existing player instead of starting another one, and KDE Plasma shows the correct taskbar icon.
- **NixOS:** The native flake package starts with the reported newer Mesa graphics stack after refreshing its dependencies.
- Screen readers announce notices and errors and correctly name the narrow Now Playing back button and Orbit session controls. Page language and song/album counts follow the selected app language.
- Assigning a shortcut no longer leaves another field waiting for the same key. Command-line player controls work again, including playing a song by ID that is not already in the queue.
