# What's New

User-facing release highlights for the in-app **What's New** screen. Maintainers refresh the
current line before promoting to `next` / `release`. Technical details and PR credits stay in
`CHANGELOG.md`.

Within each section, order by **user impact** (most noticeable first) — not PR merge order.
`CHANGELOG.md` keeps strict PR order inside Added / Changed / Fixed.


## [1.54.0]

> **Out-of-cycle release:** Psysonic 1.54.0 focuses on substantial improvements to the library migration that runs when an existing server is upgraded to Navidrome 0.64.

> **Special thanks:** We are grateful to [@thehaniak](https://github.com/thehaniak) for contributing to Psysonic's Flatpak implementation.

## Highlights

### Navidrome 0.64 migration — faster, clearer, and more reliable

- Upgrading an existing Navidrome server to 0.64 now starts the canonical-ID migration before other library work can delay it.
- The startup screen shows responsive progress for each migration stage, while faster native rewrites, library updates, and final sync reduce the wait on large libraries.
- A clean Psysonic setup connected directly to Navidrome 0.64 skips the blocking migration entirely. When migration is required, the details show which configured server is being updated.

## Fixed

### Browse and library

- Album, artist, playlist, radio, and Offline Library card grids no longer overlap or cut off titles on wide windows with a low column setting.

### Other

- Settings open normally after importing a backup, including **Settings → Themes**. Affected installs repair the stored language value automatically on the next start.
