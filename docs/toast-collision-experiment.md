# Local playback collision experiment

Branch: `fix/toast-local-playback-collision`.

This is an experimental migration-only fix, not a complete cache recovery system.
Local entries that resolve to the same server and canonical track ID may have
different paths. Preserve a read-back-verified snapshot of the original local
playback and offline stores before rewriting them. Keep the first snapshot on
retry under `psysonic-local-playback-collision-recovery-v1:<serverIndexKey>`.
Never delete either file as part of collision resolution.

For different paths, prefer an original-bytes-verified entry, then tier and
cache timestamp. Keep file metadata from that entry together, merge pin sources,
and retain the latest play timestamp. The snapshot retains the losing entries.
Disk availability is not checked here, and the snapshot is not automatically
used as a playback fallback. Writer normalization and recovery UI are follow-ups.

## Checks

- Migration tests: 83 passed across 10 files.
- TypeScript: `npx tsc --noEmit` passed.
- Private local playback/offline rehearsal: 859 entries -> 524; canonical
  verification, exact recovery snapshot, and second-run idempotency passed.
- No private fixtures or credentials are included in this branch.
- Reporter acceptance: Toast confirmed normal operation of the Ubuntu-built
  test AppImage from Linux Bundle Test run 37231154682 (reported via Discord).

## Remaining review scope

Runtime benchmark: not applicable. This persisted-state migration layer is
outside the route benchmark's coverage. Per maintainer direction, acceptance
uses migration regression tests, the private-state rehearsal, successful Linux
packaging and Toast's confirmation, not a broad frontend run. No performance
improvement or complete disk-recovery implementation is claimed.

## User test

1. Fully quit the normal application, including the tray icon.
2. Keep untouched copies of both the original broken profile and the working
   fresh profile. Test on a copy of the original profile, not the only backup.
3. Mount the original external download disk at its usual location.
4. Run the experimental build; allow migration to finish.
5. Check streaming, offline playback, downloaded albums/playlists, and restart.
6. Report whether the migration completes and whether local tracks still play.

Do not use a normal updater to overwrite the experimental build during the test.
The build shares the normal app identifier and reads the normal data location;
do not run it alongside the stable application. Backend/full-file migration has
not been rehearsed against the reporter's mounted disk.
