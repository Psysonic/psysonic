use super::*;

// ── apply_template ────────────────────────────────────────────────────────

#[test]
fn apply_template_replaces_all_placeholders() {
    let out = apply_template(
        "{artist} - {title} ({album})",
        "Comfortably Numb",
        "Pink Floyd",
        Some("The Wall"),
    );
    assert_eq!(out, "Pink Floyd - Comfortably Numb (The Wall)");
}

#[test]
fn apply_template_substitutes_empty_for_missing_album() {
    let out = apply_template("{album}", "t", "a", None);
    assert_eq!(out, "");
}

#[test]
fn apply_template_leaves_unknown_placeholders_untouched() {
    // Only {title}, {artist}, {album} are supported — {year} stays literal.
    let out = apply_template("{title} ({year})", "t", "a", None);
    assert_eq!(out, "t ({year})");
}

#[test]
fn apply_template_repeats_replacement_for_repeated_placeholder() {
    let out = apply_template("{artist} / {artist}", "t", "AC/DC", None);
    assert_eq!(out, "AC/DC / AC/DC");
}

// ── compute_discord_text_fields ──────────────────────────────────────────

#[test]
fn text_fields_use_documented_defaults_when_templates_are_none() {
    let f = compute_discord_text_fields("Song", "Artist", Some("Album"), None, None, None, None);
    assert_eq!(f.name, "");
    assert_eq!(f.details, "Artist - Song");
    assert_eq!(f.state, "Album");
    assert_eq!(f.large_text, "Album");
}

#[test]
fn text_fields_apply_supplied_templates_overriding_defaults() {
    let f = compute_discord_text_fields(
        "Song",
        "Artist",
        Some("Album"),
        Some("{title} | {album}"),
        Some("by {artist}"),
        Some("{album} ({artist})"),
        Some("{title} ({artist})"),
    );
    assert_eq!(f.name, "Song (Artist)");
    assert_eq!(f.details, "Song | Album");
    assert_eq!(f.state, "by Artist");
    assert_eq!(f.large_text, "Album (Artist)");
}

#[test]
fn text_fields_substitute_empty_for_missing_album() {
    let f = compute_discord_text_fields("Song", "Artist", None, None, None, None, None);
    // {album} placeholder → empty, but the surrounding template stays.
    assert_eq!(f.name, "");
    assert_eq!(f.details, "Artist - Song");
    assert_eq!(f.state, "");
    assert_eq!(f.large_text, "");
}

#[test]
fn text_fields_handle_unicode_and_special_characters() {
    let f = compute_discord_text_fields(
        "Bohemian Rhapsody",
        "Queen",
        Some("A Night at the Opera"),
        Some("{artist} – {title}"),
        None,
        None,
        None,
    );
    assert_eq!(f.name, "");
    assert_eq!(f.details, "Queen – Bohemian Rhapsody");
}

// ── compute_discord_start_timestamp ──────────────────────────────────────

#[test]
fn start_timestamp_subtracts_floor_of_elapsed() {
    // elapsed=42.7 → floor=42; start = now - 42
    assert_eq!(
        compute_discord_start_timestamp(42.7, 1_700_000_000),
        1_699_999_958
    );
}

#[test]
fn start_timestamp_for_zero_elapsed_equals_now() {
    assert_eq!(
        compute_discord_start_timestamp(0.0, 1_700_000_000),
        1_700_000_000
    );
}

#[test]
fn start_timestamp_handles_fractional_seconds_via_floor() {
    // 0.999 → floor 0 (same as just-started)
    assert_eq!(
        compute_discord_start_timestamp(0.999, 1_700_000_000),
        1_700_000_000
    );
    // 1.0001 → floor 1
    assert_eq!(
        compute_discord_start_timestamp(1.0001, 1_700_000_000),
        1_699_999_999
    );
}

// ── compute_discord_end_timestamp ──────────────────────────────────────

#[test]
fn end_timestamp_adds_rounded_duration_to_start() {
    // 42.2 → round 42; end = start + 42
    assert_eq!(
        compute_discord_end_timestamp(1_700_000_000, Some(42.2)),
        Some(1_700_000_042)
    );
    // 42.8 → round 43; end = start + 43
    assert_eq!(
        compute_discord_end_timestamp(1_700_000_000, Some(42.8)),
        Some(1_700_000_043)
    );
}

#[test]
fn end_timestamp_is_none_when_duration_is_missing() {
    assert_eq!(compute_discord_end_timestamp(1_700_000_000, None), None);
}

#[test]
fn end_timestamp_is_none_for_zero_duration() {
    assert_eq!(
        compute_discord_end_timestamp(1_700_000_000, Some(0.0)),
        None
    );
}

#[test]
fn end_timestamp_is_none_for_negative_duration() {
    assert_eq!(
        compute_discord_end_timestamp(1_700_000_000, Some(-3.5)),
        None
    );
}

#[test]
fn end_timestamp_is_none_for_nan_duration() {
    assert_eq!(
        compute_discord_end_timestamp(1_700_000_000, Some(f64::NAN)),
        None
    );
}

#[test]
fn end_timestamp_is_none_for_overflowing_duration() {
    assert_eq!(
        compute_discord_end_timestamp(1_700_000_000, Some(1e300)),
        None
    );
    assert_eq!(
        compute_discord_end_timestamp(i64::MAX - 10, Some(20.0)),
        None
    );
}
