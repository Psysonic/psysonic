# What's New

User-facing release highlights for the in-app **What's New** screen. Maintainers refresh the
current line before promoting to `next` / `release`. Technical details and PR credits stay in
`CHANGELOG.md`.

Within each section, order by **user impact** (most noticeable first) — not PR merge order.
`CHANGELOG.md` keeps strict PR order inside Added / Changed / Fixed.


## [1.57.0]

## Highlights

### Track tables — resize and arrange columns

- Drag a divider to resize just that column, double-click it to fit its contents, or drag a column header into a new position.
- Right-click the header to show or hide columns, fit all columns or reset the layout. Wide tables gain a horizontal scrollbar, and their headers stay visible while scrolling down.
- The same controls work throughout the app, including albums, playlists, favourites and search, with keyboard controls for sorting, moving and resizing columns.

### New Releases — share your recent additions

- The image button in **New Releases** saves albums added since a chosen date as PNG images in a compact, two-column catalog. **Ctrl+Shift+Alt+N** opens the same dialog.
- Choose a light or dark style; the dialog shows the album count, number of images and destination. Text in the images follows your app language.
- Hide the button under **Settings → Personalisation → New Releases**.

### Choose which album year you see

- Show the original year, reissue year or both on album cards and headers, album tables and Home rows. Choose beside the album sorting on artist pages or under **Settings → Appearance**; both use the same setting.
- Original year is the default. Dates come from Navidrome and fill in with the next library check after updating; missing dates keep their previous display. Sorting albums by year is unchanged.

### Discord — song progress and better covers

- Rich Presence shows the song's progress and updates when you seek. **Cover art source → Follow in-app sources** can show the external covers your server uses instead of the Psysonic icon, and failed cover lookups are retried sooner.
- The member-list status shows the artist, and the profile card reads **Listening to Psysonic** with the title and artist below. Untouched templates switch automatically; templates you edited stay as they are.

### Back and forward from the header

- Header arrows revisit pages, with **Alt+← / Alt+→** or **⌘[ / ⌘]** on macOS. Change the shortcuts under **Settings → Input**; existing assignments keep priority.
- **Settings → Appearance → Show back / forward buttons in the header** can hide the arrows without disabling the shortcuts.

### Full Wave seekbar

- **Settings → Appearance → Seekbar style** gains **Full Wave**: the played portion becomes a gently moving wave while the rest stays flat. Pulse Wave is unchanged.

### Choose Orbit reshuffling before you start

- The Orbit start dialog offers **Automatic reshuffle**, off by default, and remembers your choice for next time. You can still change it in the session settings while listening.

## Improved

- The Italian translation has been rewritten from the English text. Wording has changed throughout; corrections from Italian speakers are welcome.

## Fixed

### Playback and audio

- **Linux:** Native Hi-Res playback no longer runs at half speed with rhythmic gaps on affected PipeWire setups.
- Repeated AutoDJ crossfades no longer leave the seekbar and synchronised lyrics ahead of the music or trigger the next transition too early.
- Gapless playlists continue after tracks with trimmed encoder padding, including affected AAC/M4A files. Pausing after a gapless transition also keeps the mini player's progress bar at the correct position.
- A finished queue no longer flashes the seekbar or repeatedly reloads its last track.

### Offline, Now Playing, and Navidrome

- Editing a smart playlist retains the album rules and refresh delay added in **Navidrome 0.64**. If an earlier edit dropped rules, check the playlist and add those rules again.
- Song Info loads for downloaded and cached tracks when the server is reachable; it remains unavailable offline.
- Artist pages use the server's Top Songs ranking with all libraries selected, instead of falling back to your own most-played tracks.

### Themes and integrations

- Servers behind header-auth gates such as Pangolin or Cloudflare Access can be paired with a local address again.
- Server setup rejects incorrect Bandcamp credentials instead of saving an unusable connection. Login and server forms also warn about leading or trailing password spaces without changing the password.

### Browse and library

- Albums and Artists update in place after a background sync instead of emptying and sending you back to the top.
- Featured-artist links open that artist's own page and albums, rather than a mixed page or an error.
- Originals and reissues tagged with the same original year remain separate when Navidrome reports their different release years. Libraries read through the Subsonic API still rely on the year tag; album groups rebuild once after updating.
- Album covers recover after retagging: old server placeholders are checked again after 30 minutes, and an album's own cover takes priority over an earlier external image on its page.
- Non-square covers and playlist cards stay sharp in grids. Existing cached covers are redrawn once in the background from local copies, including while offline.

### Other

- Device Sync lists tracks skipped because of filename conflicts, the track keeping each file and its path. An occupied destination path is identified correctly instead of being blamed on two tracks.
- Radio station cards show a play button and use a radio icon when artwork is missing, instead of cast icons.
- **Linux:** Media widgets can find Psysonic's icon instead of showing a generic or blank one.

## Under the hood

- Theme imports, backups and network redirects gain security fixes.
