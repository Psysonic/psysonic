//! Runtime smoke test for the macOS DiscRecording bindings.
#![cfg(target_os = "macos")]

use psysonic_burn::platform;

#[test]
fn enumerating_drives_reaches_the_framework_without_crashing() {
    // Exercises DRCopyDeviceArray, DRDeviceCopyInfo/Status, every dictionary
    // lookup and the CfOwned release path. Loops so an over-release shows up
    // as a crash rather than as a lucky first pass.
    for _ in 0..200 {
        let recorders = platform::list_recorders().expect("enumeration should not error");
        for recorder in &recorders {
            assert!(!recorder.id.is_empty(), "a listed drive must have an id");
            let _ = platform::probe_media(&recorder.id);
        }
    }
    assert!(platform::is_supported(), "macOS has a burn backend");
}

#[test]
fn probing_a_drive_that_is_not_there_fails_with_a_readable_message() {
    let error = platform::probe_media("IOService:/nope").unwrap_err();
    assert!(
        error.contains("no longer available"),
        "unexpected message: {error}"
    );
}

#[test]
fn verifying_cd_text_without_a_drive_says_so_rather_than_claiming_an_empty_disc() {
    // The distinction the Windows path got wrong once: "could not check" must
    // never be reported as "the drive wrote nothing".
    // Reached through `platform` because `mod macos` is private and this is an
    // integration test. That dispatcher is macOS-only now: the button that used
    // to need all three backends is gone, and only this implementation is still
    // live, because the burn reads its own CD-TEXT back through it.
    match platform::verify_cd_text("IOService:/nope") {
        Ok(result) => assert!(!result.checked, "must not claim a completed check"),
        Err(error) => assert!(!error.is_empty()),
    }
}
