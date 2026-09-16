//! A cheap look at the tracks a burn will have to download, before it downloads
//! any of them.
//!
//! A track the library indexes but the server can no longer produce used to
//! surface at the worst possible moment: after every track ahead of it had been
//! downloaded and decoded, as `could not be prepared: unrecognised audio
//! format`. The disc was abandoned and all of that work paid for again on the
//! next attempt, once the offending track had been found by hand.
//!
//! So every track that needs fetching is asked for its first few kilobytes
//! first. That is enough to catch a server answering with an error envelope
//! instead of audio — most often a file moved or deleted since the last library
//! scan — for a few kilobytes per track and a second or so overall.
//!
//! The rule this module holds to: **it may only turn a burn down for something
//! it is certain about.** A timeout, a proxy that will not serve ranged
//! requests, an unfamiliar status, a body it cannot read — anything ambiguous —
//! and it stands down and lets the real download have its say. Blocking a disc
//! that would have burned perfectly well is a worse failure than missing a bad
//! track, which the render step still catches.
//!
//! Reading the envelope is deliberately local to this crate. `psysonic-analysis`
//! has its own reader for a different job — refusing to fingerprint an error
//! page — and sharing them would mean moving code into `psysonic-core`. Both are
//! small, both are tested where they live, and a CD burner is not a reason to
//! reach into other crates.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use psysonic_core::server_http::ServerHttpRegistry;
use psysonic_syncfs::file_transfer::apply_server_http_get;

use crate::model::BurnTrackInput;

/// How much of each track to look at. A Subsonic error envelope is a few
/// hundred bytes; this is room to spare without being worth a progress bar.
const PREFIX_BYTES: usize = 8 * 1024;

/// Per-track ceiling. The burn's own fetch timeout is ten minutes, which is
/// right for a whole file and far too long to spend deciding whether to start.
const PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(10);

/// What a server said when it refused, in its own words.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerRefusal {
    pub code: i64,
    pub message: String,
}

impl ServerRefusal {
    /// The server knows of the track but cannot produce the file.
    ///
    /// Worth separating from every other refusal because it is the one the user
    /// can act on: the library index is ahead of what is actually on the
    /// server's disk, and a rescan is what fixes it.
    pub fn is_source_unavailable(&self) -> bool {
        self.code == 70
            || self
                .message
                .to_ascii_lowercase()
                .contains("no such file or directory")
    }
}

/// Whether the body is an error envelope rather than media bytes.
///
/// Deliberately shallow: it reads the first bytes only, so it still works on a
/// prefix cut short where a full parse would fail. Nothing that starts `{` or
/// `<?xml` is audio, so a positive answer is safe to act on even though it
/// cannot say *which* error it is.
fn looks_like_error_envelope(body: &[u8]) -> bool {
    let head = &body[..body.len().min(512)];
    let trimmed = head
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .map(|at| &head[at..])
        .unwrap_or(head);
    trimmed.starts_with(b"{") || trimmed.starts_with(b"<?xml") || trimmed.starts_with(b"<subsonic")
}

/// The error's own code and message, when the body is a complete JSON envelope.
///
/// Returns `None` for XML envelopes and for a prefix cut short mid-object;
/// `looks_like_error_envelope` still recognises both.
fn parse_error_envelope(body: &[u8]) -> Option<ServerRefusal> {
    let envelope: serde_json::Value = serde_json::from_slice(body).ok()?;
    let error = envelope.get("subsonic-response")?.get("error")?;
    Some(ServerRefusal {
        code: error
            .get("code")
            .and_then(|value| value.as_i64())
            .unwrap_or(-1),
        message: error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
    })
}

/// Why a track will not download, in the cases worth acting on before a burn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// The server named its own reason.
    Server(ServerRefusal),
    /// An error envelope whose detail could not be read — an XML one, or a
    /// prefix cut short. Still certainly not audio.
    Envelope,
    /// A status that will not answer differently if asked again.
    Status(u16),
}

/// Whether a permanent answer, rather than one worth another try.
///
/// Only what cannot change on its own. `401` and `403` are left out on purpose:
/// an expired token or a reverse-proxy gate is recoverable and is shared with
/// playback, so treating either as fatal would block discs over a transient
/// authentication state. `408`, `429` and every `5xx` are transient by
/// definition.
fn permanently_gone(status: u16) -> bool {
    status == 404 || status == 410
}

/// What a preflight response means, given only what the response said.
///
/// Pure, so the judgement can be tested without a server standing in.
pub fn verdict(status: u16, head: &[u8]) -> Option<Refusal> {
    // The body comes first: the case this exists for arrives as HTTP 200 with
    // an error envelope, where the status alone looks like success.
    if let Some(error) = parse_error_envelope(head) {
        return Some(Refusal::Server(error));
    }
    if looks_like_error_envelope(head) {
        return Some(Refusal::Envelope);
    }
    if permanently_gone(status) {
        return Some(Refusal::Status(status));
    }
    None
}

/// Take as much of `chunk` as the window still has room for.
///
/// Returns whether the window is now full, which is the caller's signal to stop
/// reading and drop the response. Split out of the read loop because the bound
/// is the part worth testing on its own: without it, a server that ignores
/// `Range` would have its whole track buffered just to decide whether to start.
fn fill_window(head: &mut Vec<u8>, chunk: &[u8]) -> bool {
    let room = PREFIX_BYTES.saturating_sub(head.len());
    head.extend_from_slice(&chunk[..chunk.len().min(room)]);
    head.len() >= PREFIX_BYTES
}

/// Ask one track's server for the first `PREFIX_BYTES` and judge the answer.
///
/// `None` means "nothing certain to report", which covers both a healthy track
/// and every ambiguity.
pub async fn check_track(
    track: &BurnTrackInput,
    client: &reqwest::Client,
    registry: Option<&ServerHttpRegistry>,
) -> Option<Refusal> {
    let url = track
        .download_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())?;

    let mut response = apply_server_http_get(client, registry, track.server_id.as_deref(), url)
        .header("Range", format!("bytes=0-{}", PREFIX_BYTES - 1))
        .timeout(PREFLIGHT_TIMEOUT)
        .send()
        .await
        .ok()?;

    let status = response.status().as_u16();

    // Bounded regardless of what comes back: a server that ignores Range sends
    // the whole track, and dropping the response once the window is full closes
    // the connection rather than reading a 40 MB FLAC to decide whether to
    // start.
    let mut head: Vec<u8> = Vec::with_capacity(PREFIX_BYTES);
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if fill_window(&mut head, &chunk) {
                    break;
                }
            }
            Ok(None) => break,
            // A body that would not read is not proof of anything.
            Err(_) => return None,
        }
    }

    verdict(status, &head)
}

/// Check every track in `indices`, in order, and report all of them.
///
/// Sequential on purpose, matching the fetch gate: a dozen parallel requests
/// only make one server race itself. Reporting every refusal rather than
/// stopping at the first means a queue with two bad tracks is fixed once
/// instead of twice.
pub async fn check_tracks(
    tracks: &[BurnTrackInput],
    indices: &[usize],
    client: &reqwest::Client,
    registry: Option<&ServerHttpRegistry>,
    cancel: &AtomicBool,
    on_track: &(dyn Fn(usize) + Sync),
) -> Vec<(String, Refusal)> {
    let mut refused = Vec::new();
    for &index in indices {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let Some(track) = tracks.get(index) else {
            continue;
        };
        on_track(index);
        if let Some(refusal) = check_track(track, client, registry).await {
            refused.push((track.title.clone(), refusal));
        }
    }
    refused
}

fn reason(refusal: &Refusal) -> String {
    match refusal {
        Refusal::Server(error) if error.is_source_unavailable() => {
            if error.message.is_empty() {
                "the server no longer has the file".to_string()
            } else {
                format!("the server no longer has the file ({})", error.message)
            }
        }
        Refusal::Server(error) if !error.message.is_empty() => {
            format!("the server refused it: {}", error.message)
        }
        Refusal::Server(error) => format!("the server refused it (code {})", error.code),
        Refusal::Envelope => "the server sent an error instead of audio".to_string(),
        Refusal::Status(status) => format!("the server answered HTTP {status}"),
    }
}

/// The message a refused preflight fails the burn with.
pub fn describe(refused: &[(String, Refusal)]) -> String {
    if let [(title, refusal)] = refused {
        return format!(
            "“{title}” cannot be downloaded: {}. Remove it from the running order, or rescan the server, and try again.",
            reason(refusal)
        );
    }
    let mut message = format!("{} tracks cannot be downloaded:", refused.len());
    for (title, refusal) in refused {
        message.push_str(&format!("\n• “{title}” — {}", reason(refusal)));
    }
    message.push_str("\nRemove them from the running order, or rescan the server, and try again.");
    message
}

#[cfg(test)]
mod tests {
    use super::*;

    const REFUSAL_JSON: &[u8] = br#"{"subsonic-response":{"status":"failed","error":{"code":0,"message":"open /music/a.mp3: no such file or directory"}}}"#;
    /// An MP3 frame header, which is what a healthy answer starts with.
    const AUDIO: &[u8] = &[0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00];

    #[test]
    fn a_missing_file_is_read_out_of_the_envelope() {
        let error = parse_error_envelope(REFUSAL_JSON).unwrap();
        assert_eq!(error.code, 0);
        assert_eq!(
            error.message,
            "open /music/a.mp3: no such file or directory"
        );
        assert!(error.is_source_unavailable());
    }

    #[test]
    fn code_70_is_an_unavailable_source_whatever_the_wording() {
        let error = ServerRefusal {
            code: 70,
            message: "The requested data was not found".to_string(),
        };
        assert!(error.is_source_unavailable());
    }

    #[test]
    fn an_ordinary_api_error_is_not_an_unavailable_source() {
        // Wrong credentials is a refusal, but not the kind a rescan fixes.
        let error = ServerRefusal {
            code: 40,
            message: "Wrong username or password".to_string(),
        };
        assert!(!error.is_source_unavailable());
    }

    #[test]
    fn bodies_that_are_not_error_envelopes_do_not_parse() {
        assert!(parse_error_envelope(br#"{"subsonic-response":{"status":"ok"}}"#).is_none());
        assert!(parse_error_envelope(br#"{"something":"else"}"#).is_none());
        assert!(parse_error_envelope(AUDIO).is_none());
        assert!(parse_error_envelope(&[]).is_none());
    }

    #[test]
    fn audio_and_empty_bodies_are_not_mistaken_for_envelopes() {
        // An MP3 frame header, a FLAC magic number, an ID3 tag.
        assert!(!looks_like_error_envelope(AUDIO));
        assert!(!looks_like_error_envelope(b"fLaC"));
        assert!(!looks_like_error_envelope(b"ID3\x04\x00"));
        assert!(!looks_like_error_envelope(&[]));
    }

    #[test]
    fn an_error_envelope_served_as_success_is_still_a_refusal() {
        // The whole reason this module exists: HTTP 200, and not audio.
        let Some(Refusal::Server(error)) = verdict(200, REFUSAL_JSON) else {
            panic!("a 200 carrying an error envelope must be refused");
        };
        assert!(error.is_source_unavailable());
    }

    #[test]
    fn an_xml_envelope_is_refused_even_though_its_detail_cannot_be_read() {
        let xml = br#"<?xml version="1.0"?><subsonic-response status="failed"/>"#;
        assert_eq!(verdict(200, xml), Some(Refusal::Envelope));
    }

    #[test]
    fn a_truncated_envelope_is_refused() {
        // The window cuts the JSON off mid-object, so it will not parse; the
        // shallow check is what catches it.
        assert_eq!(verdict(200, &REFUSAL_JSON[..40]), Some(Refusal::Envelope));
    }

    #[test]
    fn audio_passes_whatever_the_range_handling() {
        // 206 is the answer asked for; 200 means the server ignored Range and
        // began sending the whole file, which is not a reason to refuse.
        assert_eq!(verdict(206, AUDIO), None);
        assert_eq!(verdict(200, AUDIO), None);
    }

    #[test]
    fn only_permanent_statuses_stop_a_burn() {
        assert_eq!(verdict(404, &[]), Some(Refusal::Status(404)));
        assert_eq!(verdict(410, &[]), Some(Refusal::Status(410)));
        // Everything recoverable stands down and lets the real fetch try: an
        // expired token, a proxy gate, a busy or broken server.
        for status in [401, 403, 408, 429, 500, 502, 503] {
            assert_eq!(
                verdict(status, &[]),
                None,
                "HTTP {status} must not be fatal"
            );
        }
    }

    #[test]
    fn an_empty_or_unreadable_body_is_not_evidence() {
        assert_eq!(verdict(200, &[]), None);
        assert_eq!(verdict(206, b"\x00\x00\x00\x00"), None);
    }

    #[test]
    fn the_servers_own_words_reach_the_message() {
        let error = parse_error_envelope(REFUSAL_JSON).unwrap();
        let text = describe(&[("Walk This World".to_string(), Refusal::Server(error))]);

        assert!(text.contains("Walk This World"), "{text}");
        assert!(text.contains("no such file or directory"), "{text}");
        // The phrase that separates this from every other refusal. Asserting
        // only the server's words would pass even if the branch were wrong.
        assert!(text.contains("no longer has the file"), "{text}");
        // The user has to be told what to do about it.
        assert!(text.contains("rescan"), "{text}");
    }

    #[test]
    fn every_bad_track_is_named_not_just_the_first() {
        let text = describe(&[
            ("First".to_string(), Refusal::Envelope),
            ("Second".to_string(), Refusal::Status(404)),
        ]);

        assert!(text.contains("2 tracks"), "{text}");
        assert!(text.contains("First"), "{text}");
        assert!(text.contains("Second"), "{text}");
        assert!(text.contains("404"), "{text}");
    }

    #[test]
    fn a_refusal_that_is_not_a_missing_file_is_worded_as_itself() {
        // Wrong credentials must not be reported as a missing file, which would
        // send the user to rescan a server that is working fine.
        let error = ServerRefusal {
            code: 40,
            message: "Wrong username or password".to_string(),
        };
        let text = describe(&[("Track".to_string(), Refusal::Server(error))]);

        assert!(text.contains("Wrong username or password"), "{text}");
        assert!(!text.contains("no longer has the file"), "{text}");
    }

    #[test]
    fn the_window_is_eight_kibibytes() {
        // Pinned outright. Every other test that cares derives its expectation
        // from this constant, so nothing else would notice it changing.
        assert_eq!(PREFIX_BYTES, 8192);
    }

    #[test]
    fn the_window_stops_at_its_size_however_the_chunks_arrive() {
        let mut head = Vec::new();
        assert!(!fill_window(&mut head, &[0_u8; 100]), "not full yet");
        assert_eq!(head.len(), 100);

        // A chunk far larger than the room left is truncated to it.
        assert!(fill_window(&mut head, &vec![0_u8; PREFIX_BYTES * 2]));
        assert_eq!(head.len(), PREFIX_BYTES, "the window must not overrun");
    }

    #[test]
    fn a_full_window_takes_nothing_more() {
        let mut head = vec![0_u8; PREFIX_BYTES];
        assert!(fill_window(&mut head, &[1_u8; 512]));
        assert_eq!(head.len(), PREFIX_BYTES, "a full window must not grow");
    }

    #[test]
    fn an_envelope_without_a_code_is_still_read() {
        let body = br#"{"subsonic-response":{"error":{"message":"something went wrong"}}}"#;
        let error = parse_error_envelope(body).unwrap();
        assert_eq!(error.code, -1, "a missing code must not read as a real one");
        assert_eq!(error.message, "something went wrong");
    }

    #[test]
    fn a_refusal_with_no_message_falls_back_to_its_code() {
        let error = ServerRefusal {
            code: 50,
            message: String::new(),
        };
        let text = describe(&[("Track".to_string(), Refusal::Server(error))]);
        assert!(text.contains("code 50"), "{text}");
    }

    #[test]
    fn a_missing_file_with_no_message_still_says_which_failure_it_was() {
        let error = ServerRefusal {
            code: 70,
            message: String::new(),
        };
        let text = describe(&[("Track".to_string(), Refusal::Server(error))]);
        assert!(text.contains("no longer has the file"), "{text}");
        assert!(!text.contains("()"), "an empty reason must not be printed");
    }

    // ── Over a real socket ───────────────────────────────────────────────
    //
    // The judgement above is pure; these cover the parts that only exist once
    // there is a server on the other end: the range request, the bounded read,
    // and standing down when the network is the problem.

    use wiremock::matchers::{header, method, path as wm_path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn track_at(url: &str) -> BurnTrackInput {
        BurnTrackInput {
            source_path: None,
            download_url: Some(url.to_string()),
            suffix: Some("mp3".to_string()),
            server_id: None,
            size_bytes: Some(5_000_000),
            title: "Walk This World".to_string(),
            artist: "Heather Nova".to_string(),
            duration_sec: 240.0,
            isrc: None,
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn only_the_window_is_asked_for_and_audio_passes() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(wm_path("/download"))
            // Spelled out rather than built from PREFIX_BYTES: an expectation
            // derived from the constant moves with it and pins nothing.
            .and(header("Range", "bytes=0-8191"))
            .respond_with(ResponseTemplate::new(206).set_body_bytes(AUDIO.to_vec()))
            .mount(&server)
            .await;

        let track = track_at(&format!("{}/download", server.uri()));
        // A mismatched Range would fall through to wiremock's own 404 and come
        // back as a refusal, so this also pins the header that was sent.
        assert_eq!(
            check_track(&track, &reqwest::Client::new(), None).await,
            None
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_envelope_is_caught_from_the_head_of_a_long_body() {
        // A megabyte of padding behind the envelope: the answer has to come out
        // of the first few kilobytes, which is the whole point of asking for a
        // window rather than the file.
        let mut body = REFUSAL_JSON.to_vec();
        body.extend(std::iter::repeat_n(b' ', 1024 * 1024));
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(wm_path("/download"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body))
            .mount(&server)
            .await;

        let track = track_at(&format!("{}/download", server.uri()));
        let Some(Refusal::Server(error)) = check_track(&track, &reqwest::Client::new(), None).await
        else {
            panic!("an error envelope must be refused");
        };
        assert!(error.is_source_unavailable());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_track_the_server_no_longer_serves_is_refused_by_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(wm_path("/download"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let track = track_at(&format!("{}/download", server.uri()));
        assert_eq!(
            check_track(&track, &reqwest::Client::new(), None).await,
            Some(Refusal::Status(404))
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_server_that_cannot_be_reached_stands_down() {
        // Nothing listens on port 1. A network problem says nothing about the
        // track, and must not be allowed to stop a burn that would succeed.
        let track = track_at("http://127.0.0.1:1/download");
        assert_eq!(
            check_track(&track, &reqwest::Client::new(), None).await,
            None
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_track_with_no_address_is_left_to_the_download_to_report() {
        let mut track = track_at("unused");
        track.download_url = None;
        assert_eq!(
            check_track(&track, &reqwest::Client::new(), None).await,
            None
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn every_listed_track_is_checked_and_only_the_bad_ones_reported() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(wm_path("/good"))
            .respond_with(ResponseTemplate::new(206).set_body_bytes(AUDIO.to_vec()))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(wm_path("/bad"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(REFUSAL_JSON.to_vec()))
            .mount(&server)
            .await;

        let mut good = track_at(&format!("{}/good", server.uri()));
        good.title = "Good".to_string();
        let mut bad = track_at(&format!("{}/bad", server.uri()));
        bad.title = "Bad".to_string();
        let tracks = vec![good, bad];

        let seen = std::sync::Mutex::new(Vec::new());
        let cancel = AtomicBool::new(false);
        let refused = check_tracks(
            &tracks,
            &[0, 1],
            &reqwest::Client::new(),
            None,
            &cancel,
            &|index| seen.lock().unwrap().push(index),
        )
        .await;

        assert_eq!(refused.len(), 1, "only the bad track should be reported");
        assert_eq!(refused[0].0, "Bad");
        assert_eq!(*seen.lock().unwrap(), vec![0, 1]);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_cancelled_preflight_never_reaches_the_network() {
        let cancel = AtomicBool::new(true);
        let tracks = vec![track_at("http://127.0.0.1:1/download")];
        let seen = std::sync::Mutex::new(Vec::new());

        let refused = check_tracks(
            &tracks,
            &[0],
            &reqwest::Client::new(),
            None,
            &cancel,
            &|index| seen.lock().unwrap().push(index),
        )
        .await;

        assert!(refused.is_empty());
        assert!(seen.lock().unwrap().is_empty());
    }
}
