//! Normalized file mood tags from OpenSubsonic `moods[]`.
//!
//! Navidrome exposes MOOD/TMOO file metadata as a flat array of strings.
//! This module normalizes that array into the local `track_mood` projection.

use std::collections::HashSet;

use rusqlite::{params, Transaction};
use serde_json::Value;

fn dedupe_moods(moods: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for mood in moods {
        let trimmed = mood.trim();
        if trimmed.is_empty() {
            continue;
        }

        let key = trimmed.to_ascii_lowercase();

        if seen.insert(key) {
            out.push(trimmed.to_string());
        }
    }

    out
}

fn moods_from_value(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => dedupe_moods(
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect(),
        ),

        Value::String(mood) => dedupe_moods(vec![mood.clone()]),

        _ => Vec::new(),
    }
}

pub fn moods_for_track_value(raw_json: &Value) -> Vec<String> {
    raw_json
        .get("moods")
        .map(moods_from_value)
        .unwrap_or_default()
}

pub fn moods_for_track_extracted(moods_json: Option<&str>) -> Vec<String> {
    let Some(raw) = moods_json.map(str::trim).filter(|value| !value.is_empty()) else {
        return Vec::new();
    };

    // SQLite json_extract() returns arrays as JSON text but scalar strings
    // as ordinary SQL text.
    if raw.starts_with('[') {
        if let Ok(value) = serde_json::from_str::<Value>(raw) {
            return moods_from_value(&value);
        }
    }

    dedupe_moods(vec![raw.to_string()])
}

pub fn moods_for_track_raw_json(raw_json: &str) -> Vec<String> {
    serde_json::from_str::<Value>(raw_json)
        .map(|value| moods_for_track_value(&value))
        .unwrap_or_default()
}

pub fn replace_track_mood_rows(
    tx: &Transaction<'_>,
    server_id: &str,
    track_id: &str,
    album_id: Option<&str>,
    library_id: Option<&str>,
    moods: &[String],
) -> rusqlite::Result<()> {
    tx.execute(
        "DELETE FROM track_mood WHERE server_id = ?1 AND track_id = ?2",
        params![server_id, track_id],
    )?;

    if moods.is_empty() {
        return Ok(());
    }

    let mut insert = tx.prepare_cached(
        "INSERT OR IGNORE INTO track_mood \
         (server_id, track_id, mood, album_id, library_id) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;

    for mood in moods {
        insert.execute(params![server_id, track_id, mood, album_id, library_id])?;
    }

    Ok(())
}

pub fn delete_track_mood_for_track(
    conn: &rusqlite::Connection,
    server_id: &str,
    track_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM track_mood WHERE server_id = ?1 AND track_id = ?2",
        params![server_id, track_id],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_open_subsonic_moods_array() {
        let raw = json!({
            "moods": [
                "Atmospheric",
                "Melancholic",
                "Nocturnal"
            ]
        });

        assert_eq!(
            moods_for_track_value(&raw),
            vec![
                "Atmospheric".to_string(),
                "Melancholic".to_string(),
                "Nocturnal".to_string()
            ]
        );
    }

    #[test]
    fn trims_blanks_and_dedupes_case_insensitively() {
        let raw = json!({
            "moods": [
                " Atmospheric ",
                "atmospheric",
                "",
                "Dreamy",
                "DREAMY"
            ]
        });

        assert_eq!(
            moods_for_track_value(&raw),
            vec!["Atmospheric".to_string(), "Dreamy".to_string()]
        );
    }

    #[test]
    fn accepts_scalar_mood_as_fallback() {
        let raw = json!({
            "moods": "Atmospheric"
        });

        assert_eq!(moods_for_track_value(&raw), vec!["Atmospheric".to_string()]);
    }

    #[test]
    fn missing_moods_returns_empty() {
        assert!(moods_for_track_value(&json!({})).is_empty());
    }

    #[test]
    fn invalid_raw_json_returns_empty() {
        assert!(moods_for_track_raw_json("not json").is_empty());
    }
}
#[test]
fn track_upsert_projects_file_moods_into_track_mood() {
    use crate::repos::track::{TrackRepository, TrackRow};
    use crate::store::LibraryStore;

    let store = LibraryStore::open_in_memory();

    let track = TrackRow {
        server_id: "s1".into(),
        id: "t1".into(),
        title: "Test Track".into(),
        title_sort: None,
        artist: Some("Test Artist".into()),
        artist_id: None,
        album: "Test Album".into(),
        album_id: Some("al1".into()),
        album_artist: None,
        duration_sec: 180,
        track_number: Some(1),
        disc_number: Some(1),
        year: Some(2026),
        genre: Some("Ambient".into()),
        suffix: Some("flac".into()),
        bit_rate: None,
        size_bytes: None,
        cover_art_id: None,
        starred_at: None,
        user_rating: None,
        play_count: None,
        played_at: None,
        server_path: None,
        library_id: Some("lib1".into()),
        isrc: None,
        mbid_recording: None,
        bpm: None,
        replay_gain_track_db: None,
        replay_gain_album_db: None,
        replay_gain_peak: None,
        content_hash: None,
        server_updated_at: None,
        server_created_at: None,
        deleted: false,
        synced_at: 1,
        raw_json: r#"{
            "moods": [
                "Atmospheric",
                "Melancholic",
                "Nocturnal"
            ]
        }"#
        .into(),
    };

    TrackRepository::new(&store).upsert_batch(&[track]).unwrap();

    let moods: Vec<String> = store
        .with_read_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT mood
                 FROM track_mood
                 WHERE server_id = 's1'
                   AND track_id = 't1'
                 ORDER BY mood COLLATE NOCASE",
            )?;

            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            Ok(rows)
        })
        .unwrap();

    assert_eq!(
        moods,
        vec![
            "Atmospheric".to_string(),
            "Melancholic".to_string(),
            "Nocturnal".to_string(),
        ]
    );
}
