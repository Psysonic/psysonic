# Local souvlaki 0.8.3 patch

Source: the original crates.io souvlaki 0.8.3 release. The original MIT license,
copyright, package metadata and all platform implementations are retained.
Example programs, example-only dev dependencies, CI files and registry bookkeeping
are omitted. Production dependency requirements are unchanged.
The original infinite-loop README example is compile-only (`no_run`).

The local change adds optional `PlatformConfig::desktop_entry` and exports it as
the read-only string `org.mpris.MediaPlayer2.DesktopEntry` in both Linux backends.
`None` exports an empty string. Supply the case-sensitive installed desktop
filename without `.desktop`; this is distinct from the display name and bus name.
No player methods, metadata, event rates or non-Linux backends are changed.

The regression test starts its own session with `dbus-run-session` and runs the
real media-controls service in a child test process. It never uses the user bus
or starts Psysonic. From the application root:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml -p souvlaki --test desktop_entry
```

The same test also supports the original `use_dbus` backend when testing the
standalone patch crate with that feature instead. Its optional dependencies are
not enabled in Psysonic's workspace lock; do not add them there just for tests.

Revalidate this patch before updating souvlaki. Psysonic selects `FLATPAK_ID`
first, then the compile-time `PSYSONIC_DESKTOP_ENTRY` override (Nix: `psysonic`),
then Tauri's product name (`Psysonic` for deb/rpm). AppImage integrators can rename
the desktop file arbitrarily; the default assumes `Psysonic.desktop`. No directory
scans or guesses about generated AppImage filenames are made. Other packagers
installing a different filename must set the compile-time override.
