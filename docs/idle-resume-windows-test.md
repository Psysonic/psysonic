# Experimental Windows idle-resume build

This is a diagnostic build from `fix/idle-resume-recovery`, based on main.
It is not a release and does not confirm the cause of the reported regression.
See `COMMIT.txt` for the exact source revision.

## Running

- Close the installed Psysonic completely before launching this executable.
- Extract the entire artifact and run `Psysonic-idle-resume-test.exe`.
- It is unsigned; Windows may show a SmartScreen warning. Only run the artifact
  supplied by the maintainer, and compare its SHA-256 if needed.
- WebView2 must be installed (the existing Psysonic installation already needs it).
- It uses the **same settings and databases** as the installed app. Back them up
  before testing. Do not run both versions at once.
- Do not accept an automatic application update during this test; it would replace
  the diagnostic build. Return to the installed app after testing.

## Test

1. Enable Debug logging in Settings.
2. Start an MP3, then pause after at least 5 seconds.
3. Wait 90 seconds, long enough for `audio output stream released after 60s idle`.
4. Press Play once. Check sound, the timer and whether the position is preserved.
5. Repeat 3 times, and also after a 10–20 minute pause.
6. If possible repeat with sync active/inactive, without OS sleep, and separately
   after sleep. Note the selected output device and any device changes.
7. Try pressing Pause or Stop immediately after Play. Playback must not restart
   by itself. A subsequent Play should still work.

If it fails, save the **whole log before pressing Stop or restarting**, and report
whether the timer moves and whether Stop → Play restores playback. Look for
`[cold-resume]` positioning, failure, retry and resume acknowledgement entries.
Also capture `output advancing` or `no sample advancement after 5s`: these
distinguish a successful resume command from actual audio-callback activity.

## What changed

Cold resume loads a new player paused and positions the private source before it
can deliver audio. Only the still-current Play request may unpause it. A failed
attempt permits one fresh load; a second failure leaves playback inactive and
keeps the saved position. It never silently starts at zero after a failed seek.
Idle device release remains enabled. If the frontend missed the release event,
resuming a missing/empty player reports an error and falls back to the same staged
cold path, rather than reporting false success.
