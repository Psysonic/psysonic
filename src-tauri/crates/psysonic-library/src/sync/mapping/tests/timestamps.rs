use super::super::*;

#[test]
fn format_iso_roundtrips_zulu_suffix() {
    let ms = parse_iso_ms_str("2024-01-01T00:00:00Z").unwrap();
    assert_eq!(format_iso_ms_z(ms).as_deref(), Some("2024-01-01T00:00:00Z"));
}

#[test]
fn parse_iso_handles_zulu_suffix() {
    let ms = parse_iso_ms_str("2024-01-01T00:00:00Z").unwrap();
    assert_eq!(ms, 1_704_067_200_000);
}

#[test]
fn parse_iso_handles_fractional_and_offset() {
    let ms = parse_iso_ms_str("2024-01-01T00:00:00.123+02:00").unwrap();
    assert_eq!(ms, 1_704_060_000_000);
}

#[test]
fn parse_iso_handles_fractional_and_negative_offset() {
    let ms = parse_iso_ms_str("2026-08-26T22:04:58.676898-07:00").unwrap();
    assert_eq!(ms, 1_787_807_098_000);
}

#[test]
fn parse_iso_rejects_garbage() {
    assert!(parse_iso_ms_str("").is_none());
    assert!(parse_iso_ms_str("not-a-date").is_none());
    assert!(parse_iso_ms_str("9999-99-99").is_none());
    assert!(parse_iso_ms_str("2024-01-01T00:00:00+24:00").is_none());
}

// RFC 1123 timestamps — the shape a Subsonic server may send instead of ISO
// 8601. The reference values come from an independent implementation, not from
// this parser, so a shared calendar bug cannot make them agree.

#[test]
fn parse_timestamp_handles_rfc1123_without_weekday() {
    // The exact shape measured on a live server: no weekday, always GMT.
    let ms = parse_timestamp_ms_str("30 Apr 2017 08:44:05 GMT").unwrap();
    assert_eq!(ms, 1_493_541_845_000);
}

#[test]
fn parse_timestamp_handles_rfc1123_with_weekday() {
    let ms = parse_timestamp_ms_str("Sun, 30 Apr 2017 08:44:05 GMT").unwrap();
    assert_eq!(ms, 1_493_541_845_000);
}

#[test]
fn parse_timestamp_handles_rfc1123_numeric_offset() {
    let ms = parse_timestamp_ms_str("30 Apr 2017 08:44:05 +0200").unwrap();
    assert_eq!(ms, 1_493_534_645_000);
}

#[test]
fn parse_timestamp_handles_rfc1123_epoch_start() {
    let ms = parse_timestamp_ms_str("1 Jan 1970 00:00:00 GMT").unwrap();
    assert_eq!(ms, 0);
}

#[test]
fn parse_timestamp_still_prefers_iso() {
    let ms = parse_timestamp_ms_str("2024-01-01T00:00:00Z").unwrap();
    assert_eq!(ms, 1_704_067_200_000);
}

#[test]
fn parse_timestamp_rejects_unreliable_zone_names() {
    // A guessed offset would write a wrong date; a missing one only leaves NULL.
    assert!(parse_timestamp_ms_str("30 Apr 2017 08:44:05 EST").is_none());
    assert!(parse_timestamp_ms_str("30 Apr 2017 08:44:05 PDT").is_none());
}

#[test]
fn parse_timestamp_rejects_malformed_rfc1123() {
    assert!(parse_timestamp_ms_str("30 Foo 2017 08:44:05 GMT").is_none());
    assert!(parse_timestamp_ms_str("30 Apr 2017 25:44:05 GMT").is_none());
    assert!(parse_timestamp_ms_str("30 Apr 2017 08:44:05 GMT extra").is_none());
    assert!(parse_timestamp_ms_str("30 Apr 2017").is_none());
    assert!(parse_timestamp_ms_str("Apr 2017 08:44:05 GMT").is_none());
}
