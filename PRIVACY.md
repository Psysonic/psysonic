# Privacy Policy

Last updated: 28 October 2026

This policy covers the Psysonic desktop apps (Windows, macOS, Linux) and the mobile apps (iOS and Android).

Psysonic is a self-hosted music player. It does not collect telemetry, analytics, or any data on its own, and there is no Psysonic account. The Psysonic project never receives your data. Everything stays on your device or travels directly between your device and the servers and services described below.

## Your Subsonic / Navidrome server

Your server URL, username, and password are stored locally in the app's data directory. All library, search, and playback requests go directly to your own server, as do scrobbles, the play queue, and Orbit sessions (Orbit stores its sessions as playlists on your server). The Psysonic project has no access to this data.

## Automatic connections

These are the only requests Psysonic makes without you switching anything on. They carry no personal data beyond what every web request carries: your IP address and a user-agent string (operating system and web-engine version).

- **Update check (Windows, macOS, Linux)** — a few seconds after start, Psysonic asks the GitHub API (`api.github.com`) for the latest release. Installing an update downloads it from GitHub. Flatpak builds ask `flatpak.psysonic.de` instead.
- **Release notes** — once per app version, Psysonic downloads the "What's New" text from the GitHub release (`github.com`). The app version is part of the URL.
- **Theme Store** — once per launch, Psysonic loads the community theme list from `raw.githubusercontent.com` to show available theme updates. Opening the Theme Store loads theme previews from there, and installed themes are downloaded from there as well.

## Optional third-party services

Everything below is **off by default** or runs only when you actively use the feature. Nothing is sent to a service until then. Each provider's own privacy policy applies to its requests.

### Music Network (scrobble & enrichment services)
Psysonic can connect to one or more scrobble services in Settings → Integrations. Each service you connect is opt-in and independent; nothing is sent to a service you have not connected. Supported service classes:

- **Audioscrobbler / GNU FM services** — Last.fm, Libre.fm, Rocksky (AT Protocol), and any self-hosted GNU FM-compatible instance
- **ListenBrainz** — the public ListenBrainz.org service, or a self-hosted instance (e.g. Koito) via its ListenBrainz-compatible API
- **Maloja** — your own self-hosted Maloja server (native API or its ListenBrainz-compatible API)

To each connected service, Psysonic may send:
- **Scrobbles** — track title, artist, album, duration, and timestamp when a song reaches 50% playback
- **Now Playing** — the currently playing track (title, artist, album), where the service supports it
- **Love / Unlove** — when you mark a track as loved, on services that support it

Additionally, the one service you choose as your **primary** is queried to enrich the UI (your loved tracks, similar artists, track and artist info, and listening stats). All requests go directly from your device to the service's own host — the public service's host (e.g. the [Last.fm API](https://www.last.fm/api), [ListenBrainz](https://listenbrainz.org)) or, for self-hosted services, the server URL you entered. Credentials (session keys / API tokens) are stored locally and are only sent to the service they belong to. You can disconnect any service at any time in Settings.

### Lyrics: LRCLIB and NetEase Cloud Music
All lyrics sources are off for new installs; you choose them in Settings → Lyrics.
- **LRCLIB** — Psysonic sends the track title, artist, album, and duration to [lrclib.net](https://lrclib.net) as a search query. No account is required.
- **NetEase Cloud Music** — Psysonic sends the artist and title to the NetEase Cloud Music API (`music.163.com`) to search for synced lyrics, then requests the lyrics of the match. No account is required.

### Cover-art fallback: Apple Music and Last.fm
If you enable Apple Music or Last.fm as a cover source in Settings → Integrations, Psysonic looks up covers for albums your server has no artwork for. It sends the artist and album name to the [iTunes Search API](https://performance-partners.apple.com/search-api) (images come from Apple's `mzstatic.com`) or to the Last.fm API. No account is required.

### Artist images: fanart.tv and MusicBrainz
If you enable external artist artwork in Settings → Integrations, Psysonic requests artist images from [fanart.tv](https://fanart.tv) using the artist's MusicBrainz ID, plus your personal fanart.tv key if you entered one. When your server's tags carry no MusicBrainz ID, Psysonic first looks it up on [MusicBrainz](https://musicbrainz.org) by artist and album name.

### Tour dates: Bandsintown
If you enable tour dates, Psysonic sends the artist name to the [Bandsintown](https://www.bandsintown.com) API to list upcoming concerts.

### Discord Rich Presence (desktop)
If you enable Rich Presence, Psysonic connects to the local Discord client via its IPC socket to show the current track (title, artist, album, and play state). This data is sent to Discord and subject to [Discord's privacy policy](https://discord.com/privacy). Covers stay off by default. If you choose a cover source, Discord fetches the image through its own proxy: either a public share link of your server (credential parameters, LAN addresses, and non-HTTPS URLs are never published) or an Apple Music / Last.fm cover found as described above. Nothing is sent in Private Mode, or if Discord is not installed or not running.

### Internet radio
- **Station directory** — when you search the radio directory, your search text is sent to [radio-browser.info](https://www.radio-browser.info).
- **Stations** — playing a station connects to that station's stream host, and Psysonic may load the station logo and its now-playing metadata (ICY or AzuraCast) from there.

### AutoEQ
When you search headphone profiles in the equalizer, Psysonic loads the profile list from [autoeq.app](https://autoeq.app) and the chosen profile from the AutoEq repository on `raw.githubusercontent.com`.

### Shared links and external pages
- Pasting another user's Navidrome share link into the search loads that share from their server.
- Links such as Wikipedia or Last.fm artist pages open in your browser only when you click them.

## Mobile apps (iOS and Android)

Everything above applies to the mobile apps as well, except the desktop-only parts: the mobile apps do not check for updates themselves (they are updated through their store) and have no Discord Rich Presence. In addition:

- **Siri (iOS)** — voice requests such as "Play … in Psysonic" are processed by Apple under [Apple's privacy policy](https://www.apple.com/legal/privacy/). Psysonic only receives the recognised request.
- **CarPlay (iOS) and Android Auto (Android)** — track information, covers and lists are shown on your car's display. Your phone sends them directly to the car system.
- **Android Auto with the app closed** — so the car can play without opening the app on the phone, Psysonic keeps a copy of the car's lists in its private app storage: titles, covers, and the addresses to stream them from your server, which include your sign-in.
- **Lock screen and notifications** — the current track is shown in the system's media controls.
- **Files you export (iOS)** — logs and settings backups you export yourself are saved in the app's folder in the Files app.

Android permissions and what they are used for:

| Permission | Why |
|---|---|
| Internet, network state | Connect to your server and to the optional services above; wait for Wi-Fi before downloading on mobile data |
| Foreground service (media playback), wake lock | Keep music playing with the screen off |
| Foreground service (data sync) | Keep downloading a whole library with the screen off |
| Notifications | Media controls and download progress |

The mobile apps do not request location, contacts, camera, microphone or access to your photos and files.

## Data stored locally

The following data is stored only on your device, in the app's local storage directory:

- Server profiles (URL, username, password)
- Scrobble service credentials (session keys / API tokens) and the queue of scrobbles waiting to be sent
- Playback preferences, themes, keybindings, and all other settings
- Caches (covers, lyrics, library index) and synced device manifests
- On mobile: offline downloads, the play queue and the copy of the lists for Android Auto

These files are protected by your operating system's user account (on mobile, by the app sandbox). Psysonic does not encrypt them separately. Settings backups and logs you export contain only what you choose to export; a settings backup can include your server details, so keep it safe.

## No telemetry

Psysonic contains no crash reporting, analytics, usage tracking, or any form of telemetry. See [TELEMETRY.md](TELEMETRY.md).

## Children

Psysonic is not directed at children and does not knowingly collect data from anyone.

## Open source

Psysonic is fully open source under the [GNU General Public License v3.0](LICENSE). You can verify exactly what data is sent by reading the source code.

## Changes and contact

If this policy changes, the new version is published here with a new date at the top.

Questions: psysonic.dev.android@gmail.com or [GitHub issues](https://github.com/Psysonic/psysonic/issues).
