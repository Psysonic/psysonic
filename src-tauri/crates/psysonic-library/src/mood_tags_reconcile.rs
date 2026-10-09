//! Online repair for legacy mood rows whose cached JSON is ambiguous.
//!
//! Under mood_tags_v2, a native tags snapshot without tags.mood correctly
//! projected no mood. Unfortunately the old sparse merge could leave an older
//! top-level moods value beside that snapshot. The same stored shape also occurs
//! when a valid OpenSubsonic mood was combined with unrelated native tags, so
//! cached JSON cannot tell whether the mood is valid or deleted.
//!
//! This module only identifies those rows. The app scheduler resolves them from
//! fresh Navidrome metadata, then applies the native mapper's canonical mood
//! state through the normal sparse upsert path.

use rusqlite::params;

use crate::repos::{TrackRepository, TrackRow};
use crate::store::LibraryStore;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AmbiguousMoodTarget {
    pub track_id: String,
    /// Prefer the server-facing album id preserved in raw_json; fall back to
    /// the indexed album_id column when the raw payload did not carry one.
    pub album_id: Option<String>,
}

pub fn ambiguous_mood_targets(
    store: &LibraryStore,
    server_id: &str,
    limit: i64,
) -> Result<Vec<AmbiguousMoodTarget>, String> {
    store.with_read_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT
                 COALESCE(
                     NULLIF(TRIM(CASE
                         WHEN json_type(raw_json, '$.id') = 'text'
                         THEN json_extract(raw_json, '$.id')
                     END), ''),
                     id
                 ) AS server_track_id,
                 COALESCE(
                     NULLIF(TRIM(CASE
                         WHEN json_type(raw_json, '$.albumId') = 'text'
                         THEN json_extract(raw_json, '$.albumId')
                     END), ''),
                     NULLIF(TRIM(CASE
                         WHEN json_type(raw_json, '$.album_id') = 'text'
                         THEN json_extract(raw_json, '$.album_id')
                     END), ''),
                     NULLIF(TRIM(album_id), '')
                 ) AS server_album_id
             FROM track
             WHERE server_id = ?1
               AND deleted = 0
               AND json_valid(raw_json)
               AND json_type(raw_json, '$.tags') = 'object'
               AND json_type(raw_json, '$.tags.mood') IS NULL
               AND COALESCE(
                   json_extract(raw_json, '$._psysonicMoodsAuthoritative'),
                   0
               ) != 1
               AND (
                   (
                       json_type(raw_json, '$.moods') = 'array'
                       AND json_array_length(raw_json, '$.moods') > 0
                   )
                   OR (
                       json_type(raw_json, '$.moods') = 'text'
                       AND NULLIF(TRIM(json_extract(raw_json, '$.moods')), '') IS NOT NULL
                   )
               )
             ORDER BY rowid
             LIMIT ?2",
        )?;

        let rows = stmt
            .query_map(params![server_id, limit.max(1)], |row| {
                Ok(AmbiguousMoodTarget {
                    track_id: row.get(0)?,
                    album_id: row.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(rows)
    })
}

/// Apply fresh native /api/song rows through the ordinary sparse merge. The
/// native mapper has already written canonical top-level moods, including an
/// explicit empty array for an authoritative deletion.
pub fn apply_authoritative_native_mood_rows(
    store: &LibraryStore,
    rows: &[TrackRow],
    unstable_track_ids: bool,
) -> Result<usize, String> {
    if rows.is_empty() {
        return Ok(0);
    }

    TrackRepository::new(store).upsert_sparse_batch_with_remap(rows, unstable_track_ids)?;

    Ok(rows.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    use crate::sync::mapping::navidrome_song_to_track_row;

    fn ambiguous_track(raw_json: serde_json::Value) -> TrackRow {
        TrackRow {
            server_id: "s1".into(),
            id: "t1".into(),
            title: "Track".into(),
            title_sort: None,
            artist: Some("Artist".into()),
            artist_id: None,
            album: "Album".into(),
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
            raw_json: raw_json.to_string(),
        }
    }

    fn projected_moods(store: &LibraryStore) -> Vec<String> {
        store
            .with_read_conn(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT mood FROM track_mood
                     WHERE server_id = 's1' AND track_id = 't1'
                     ORDER BY mood COLLATE NOCASE",
                )?;
                let rows = stmt
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .unwrap()
    }

    #[test]
    fn finds_only_legacy_composite_rows_with_nonempty_top_level_moods() {
        let store = LibraryStore::open_in_memory();
        TrackRepository::new(&store)
            .upsert_batch(&[ambiguous_track(json!({
                "id": "t1",
                "albumId": "al1",
                "moods": ["Atmospheric"],
                "tags": { "genre": ["Ambient"] }
            }))])
            .unwrap();

        assert!(projected_moods(&store).is_empty());

        let targets = ambiguous_mood_targets(&store, "s1", 10).unwrap();
        assert_eq!(
            targets,
            vec![AmbiguousMoodTarget {
                track_id: "t1".into(),
                album_id: Some("al1".into()),
            }]
        );
    }

    #[test]
    fn authoritative_marked_composite_is_not_legacy_ambiguous() {
        let store = LibraryStore::open_in_memory();
        TrackRepository::new(&store)
            .upsert_batch(&[ambiguous_track(json!({
                "id": "t1",
                "albumId": "al1",
                "_psysonicMoodsAuthoritative": true,
                "moods": ["Atmospheric"],
                "tags": { "genre": ["Ambient"] }
            }))])
            .unwrap();

        assert_eq!(projected_moods(&store), vec!["Atmospheric".to_string()]);
        assert!(ambiguous_mood_targets(&store, "s1", 10).unwrap().is_empty());
    }

    #[test]
    fn fresh_native_mood_restores_projection_and_removes_ambiguity() {
        let store = LibraryStore::open_in_memory();
        TrackRepository::new(&store)
            .upsert_batch(&[ambiguous_track(json!({
                "id": "t1",
                "albumId": "al1",
                "moods": ["Atmospheric"],
                "tags": { "genre": ["Ambient"] }
            }))])
            .unwrap();

        let fresh = json!({
            "id": "t1",
            "title": "Track",
            "album": "Album",
            "albumId": "al1",
            "tags": {
                "genre": ["Ambient"],
                "mood": ["Atmospheric"]
            }
        });
        let row = navidrome_song_to_track_row("s1", &fresh, 2, Some("lib1")).unwrap();

        apply_authoritative_native_mood_rows(&store, &[row], false).unwrap();

        assert_eq!(projected_moods(&store), vec!["Atmospheric".to_string()]);
        assert!(ambiguous_mood_targets(&store, "s1", 10).unwrap().is_empty());
    }

    #[test]
    fn fresh_native_omission_confirms_deleted_mood_without_resurrection() {
        let store = LibraryStore::open_in_memory();
        TrackRepository::new(&store)
            .upsert_batch(&[ambiguous_track(json!({
                "id": "t1",
                "albumId": "al1",
                "moods": ["Atmospheric"],
                "tags": { "genre": ["Ambient"] }
            }))])
            .unwrap();

        let fresh = json!({
            "id": "t1",
            "title": "Track",
            "album": "Album",
            "albumId": "al1",
            "tags": { "genre": ["Ambient"] }
        });
        let row = navidrome_song_to_track_row("s1", &fresh, 2, Some("lib1")).unwrap();

        apply_authoritative_native_mood_rows(&store, &[row], false).unwrap();

        assert!(projected_moods(&store).is_empty());
        assert!(ambiguous_mood_targets(&store, "s1", 10).unwrap().is_empty());

        let raw: String = store
            .with_read_conn(|conn| {
                conn.query_row(
                    "SELECT raw_json FROM track
                     WHERE server_id = 's1' AND id = 't1'",
                    [],
                    |row| row.get(0),
                )
            })
            .unwrap();
        let raw: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(raw["moods"], json!([]));
        assert!(raw["tags"].get("mood").is_none());
    }
}
