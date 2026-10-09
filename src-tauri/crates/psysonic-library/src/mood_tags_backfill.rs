//! One-time blocking backfill: populate `track_mood` from existing `track` rows.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Emitter};

use crate::mood_tags::moods_for_track_extracted;
use crate::store::LibraryStore;

pub const MOOD_TAGS_MIGRATION_ID: &str = "mood_tags_v3";

const BATCH_SIZE: i64 = 10_000;

type BackfillTrackRow = (
    i64,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
);

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MoodTagsInspectDto {
    pub needed: bool,
    pub total_tracks: u64,
    pub done_tracks: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoodTagsProgressEvent {
    pub done: u64,
    pub total: u64,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn migration_completed(conn: &Connection) -> rusqlite::Result<bool> {
    let completed: Option<Option<i64>> = conn
        .query_row(
            "SELECT completed_at
             FROM library_data_migration
             WHERE id = ?1",
            params![MOOD_TAGS_MIGRATION_ID],
            |row| row.get(0),
        )
        .optional()?;

    Ok(completed.flatten().is_some())
}

fn count_live_tracks(conn: &Connection) -> rusqlite::Result<u64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM track
         WHERE deleted = 0",
        [],
        |row| row.get(0),
    )?;

    Ok(count.max(0) as u64)
}

fn cursor_rowid(conn: &Connection) -> rusqlite::Result<i64> {
    let rowid: Option<i64> = conn
        .query_row(
            "SELECT cursor_rowid
             FROM library_data_migration
             WHERE id = ?1",
            params![MOOD_TAGS_MIGRATION_ID],
            |row| row.get(0),
        )
        .optional()?;

    Ok(rowid.unwrap_or(0))
}

pub fn inspect_mood_tags_backfill(store: &LibraryStore) -> Result<MoodTagsInspectDto, String> {
    store.with_read_conn(|conn| {
        let total_tracks = count_live_tracks(conn)?;

        if total_tracks == 0 {
            return Ok(MoodTagsInspectDto {
                needed: false,
                total_tracks: 0,
                done_tracks: 0,
            });
        }

        if migration_completed(conn)? {
            return Ok(MoodTagsInspectDto {
                needed: false,
                total_tracks,
                done_tracks: total_tracks,
            });
        }

        let cursor = cursor_rowid(conn)?;

        let done: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM track
             WHERE deleted = 0
               AND rowid <= ?1",
            params![cursor],
            |row| row.get(0),
        )?;

        Ok(MoodTagsInspectDto {
            needed: true,
            total_tracks,
            done_tracks: done.max(0) as u64,
        })
    })
}

fn emit_progress(app: &AppHandle, done: u64, total: u64) -> Result<(), String> {
    app.emit("mood_tags:progress", MoodTagsProgressEvent { done, total })
        .map_err(|e| e.to_string())
}

pub fn run_mood_tags_backfill(store: &LibraryStore, app: &AppHandle) -> Result<(), String> {
    run_mood_tags_backfill_impl(store, Some(app))
}

fn run_mood_tags_backfill_impl(
    store: &LibraryStore,
    app: Option<&AppHandle>,
) -> Result<(), String> {
    let inspect = inspect_mood_tags_backfill(store)?;

    if !inspect.needed {
        return Ok(());
    }

    let total = inspect.total_tracks;
    let mut done = inspect.done_tracks;

    loop {
        let (batch_processed, finished) = store.with_conn_mut("mood_tags.backfill", |conn| {
            if migration_completed(conn)? {
                return Ok::<(u64, bool), rusqlite::Error>((0, true));
            }

            conn.execute(
                "INSERT INTO library_data_migration
                         (id, cursor_rowid, started_at)
                     VALUES (?1, 0, ?2)
                     ON CONFLICT(id) DO UPDATE SET
                         started_at = COALESCE(
                             library_data_migration.started_at,
                             excluded.started_at
                         )",
                params![MOOD_TAGS_MIGRATION_ID, now_unix()],
            )?;

            let cursor = cursor_rowid(conn)?;

            let mut stmt = conn.prepare(
                "SELECT
                         rowid,
                         server_id,
                         id,
                         CASE WHEN json_valid(raw_json) THEN
                                CASE
                                    -- Fresh mapping boundaries stamp explicit
                                    -- provenance when they actually observed mood
                                    -- state. Trust that canonical value even when
                                    -- sparse merging preserved unrelated native tags.
                                    WHEN COALESCE(
                                        json_extract(
                                            raw_json,
                                            '$._psysonicMoodsAuthoritative'
                                        ),
                                        0
                                    ) = 1
                                    THEN CASE
                                        WHEN json_type(raw_json, '$.moods') IN ('array', 'text')
                                        THEN json_extract(raw_json, '$.moods')
                                    END

                                    -- Preserve v2 semantics for unmarked ambiguous
                                    -- composite rows. A tags object without tags.mood
                                    -- may represent a real native deletion whose stale
                                    -- top-level moods survived the old sparse merge.
                                    WHEN json_type(raw_json, '$.tags') = 'object'
                                    THEN CASE
                                        WHEN json_type(raw_json, '$.tags.mood') IN ('array', 'text')
                                        THEN json_extract(raw_json, '$.tags.mood')
                                    END

                                    -- Rows without a native tags snapshot can safely
                                    -- use the OpenSubsonic/canonical representation.
                                    WHEN json_type(raw_json, '$.moods') IN ('array', 'text')
                                    THEN json_extract(raw_json, '$.moods')
                                END
                            END,
                         album_id,
                         library_id
                     FROM track
                     WHERE deleted = 0
                       AND rowid > ?1
                     ORDER BY rowid
                     LIMIT ?2",
            )?;

            let rows: Vec<BackfillTrackRow> = stmt
                .query_map(params![cursor, BATCH_SIZE], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            if rows.is_empty() {
                conn.execute(
                    "UPDATE library_data_migration
                         SET completed_at = ?2,
                             cursor_rowid = (
                                 SELECT COALESCE(MAX(rowid), 0)
                                 FROM track
                                 WHERE deleted = 0
                             )
                         WHERE id = ?1",
                    params![MOOD_TAGS_MIGRATION_ID, now_unix()],
                )?;

                return Ok((0_u64, true));
            }

            let batch_processed = rows.len() as u64;
            let tx = conn.unchecked_transaction()?;
            let mut last_rowid = cursor;

            {
                let mut delete = tx.prepare_cached(
                    "DELETE FROM track_mood
                    WHERE server_id = ?1 AND track_id = ?2",
                )?;

                let mut insert = tx.prepare_cached(
                    "INSERT OR IGNORE INTO track_mood
                    (server_id, track_id, mood, album_id, library_id)
                    VALUES (?1, ?2, ?3, ?4, ?5)",
                )?;

                for (rowid, server_id, track_id, moods_json, album_id, library_id) in rows {
                    let moods = moods_for_track_extracted(moods_json.as_deref());

                    delete.execute(params![server_id, track_id])?;

                    for mood in &moods {
                        insert
                            .execute(params![server_id, track_id, mood, album_id, library_id,])?;
                    }

                    last_rowid = rowid;
                }
            }

            tx.commit()?;

            conn.execute(
                "UPDATE library_data_migration
                     SET cursor_rowid = ?2
                     WHERE id = ?1",
                params![MOOD_TAGS_MIGRATION_ID, last_rowid],
            )?;

            Ok((batch_processed, false))
        })?;

        if batch_processed > 0 {
            done = done.saturating_add(batch_processed).min(total);

            if let Some(app) = app {
                emit_progress(app, done, total)?;
            }
        }

        if finished {
            break;
        }
    }

    // Handles rowid gaps caused by deleted tracks.
    store.with_conn_mut("mood_tags.backfill.finalize", |conn| {
        if migration_completed(conn)? {
            return Ok(());
        }

        let cursor = cursor_rowid(conn)?;

        let pending: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM track
             WHERE deleted = 0
               AND rowid > ?1",
            params![cursor],
            |row| row.get(0),
        )?;

        if pending == 0 {
            conn.execute(
                "UPDATE library_data_migration
                 SET completed_at = ?2,
                     cursor_rowid = (
                         SELECT COALESCE(MAX(rowid), 0)
                         FROM track
                         WHERE deleted = 0
                     )
                 WHERE id = ?1",
                params![MOOD_TAGS_MIGRATION_ID, now_unix()],
            )?;
        }

        Ok(())
    })?;

    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::navidrome_id_codec::canonical_id;
    use crate::navidrome_native_migration::{
        finalize, run_batch, upper_rowid, NavidromeNativeMigrationStep,
    };
    use crate::repos::track::{TrackRepository, TrackRow};

    fn track_with_moods(id: &str) -> TrackRow {
        TrackRow {
            server_id: "s1".into(),
            id: id.into(),
            title: id.into(),
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
        }
    }

    #[test]
    fn backfill_restores_mood_projection_from_cached_raw_json() {
        let store = LibraryStore::open_in_memory();

        TrackRepository::new(&store)
            .upsert_batch(&[track_with_moods("t1")])
            .unwrap();

        // Simulate a pre-mood-index library: the track metadata exists,
        // but its derived track_mood rows do not.
        store
            .with_conn_mut("test.clear_track_mood", |conn| {
                conn.execute("DELETE FROM track_mood", [])?;
                Ok(())
            })
            .unwrap();

        let before: i64 = store
            .with_read_conn(|conn| {
                conn.query_row("SELECT COUNT(*) FROM track_mood", [], |row| row.get(0))
            })
            .unwrap();

        assert_eq!(before, 0);

        run_mood_tags_backfill_impl(&store, None).unwrap();

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

        let inspect = inspect_mood_tags_backfill(&store).unwrap();

        assert!(!inspect.needed);
        assert_eq!(inspect.total_tracks, 1);
        assert_eq!(inspect.done_tracks, 1);
    }

    #[test]
    fn backfill_restores_moods_from_navidrome_native_tags_after_v1() {
        let store = LibraryStore::open_in_memory();

        let mut track = track_with_moods("t1");
        track.raw_json = r#"{
            "tags": {
                "mood": [
                    "Atmospheric",
                    "Melancholic",
                    "Nocturnal"
                ]
            }
        }"#
        .into();

        TrackRepository::new(&store).upsert_batch(&[track]).unwrap();

        store
            .with_conn_mut("test.simulate_v1_mood_projection", |conn| {
                // Simulate an RC1 database: the original mood backfill was
                // already marked complete, but native `tags.mood` was not
                // understood and therefore produced no projection rows.
                conn.execute("DELETE FROM track_mood", [])?;

                conn.execute(
                    "INSERT INTO library_data_migration
                         (id, cursor_rowid, started_at, completed_at)
                     VALUES ('mood_tags_v1', 1, 1, 1)",
                    [],
                )?;

                Ok(())
            })
            .unwrap();

        let before: i64 = store
            .with_read_conn(|conn| {
                conn.query_row("SELECT COUNT(*) FROM track_mood", [], |row| row.get(0))
            })
            .unwrap();

        assert_eq!(before, 0);

        // `mood_tags_v1` being complete must not suppress the newer repair.
        assert!(inspect_mood_tags_backfill(&store).unwrap().needed);

        run_mood_tags_backfill_impl(&store, None).unwrap();

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

        assert!(!inspect_mood_tags_backfill(&store).unwrap().needed);
    }

    #[test]
    fn backfill_v3_does_not_guess_ambiguous_top_level_moods_after_v2() {
        let store = LibraryStore::open_in_memory();

        let mut track = track_with_moods("t1");
        track.raw_json = r#"{
            "moods": [
                "heavy",
                "aggressive",
                "depressive"
            ],
            "tags": {
                "genre": ["Sludge", "Doom Metal"],
                "recordlabel": ["Black Star Foundation"],
                "tracktotal": ["7"]
            }
        }"#
        .into();

        TrackRepository::new(&store).upsert_batch(&[track]).unwrap();

        store
            .with_conn_mut("test.simulate_v2_mood_projection", |conn| {
                // Simulate a v2 library affected by the provenance bug:
                // valid top-level moods existed, but an unrelated tags object
                // caused the derived projection to be empty.
                conn.execute("DELETE FROM track_mood", [])?;

                conn.execute(
                    "INSERT INTO library_data_migration
                         (id, cursor_rowid, started_at, completed_at)
                     VALUES ('mood_tags_v2', 1, 1, 1)",
                    [],
                )?;

                Ok(())
            })
            .unwrap();

        assert!(
            inspect_mood_tags_backfill(&store).unwrap().needed,
            "completed v2 must not suppress the v3 repair"
        );

        run_mood_tags_backfill_impl(&store, None).unwrap();

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

        assert!(
            moods.is_empty(),
            "v3 must leave an ambiguous v2 row unprojected until current server metadata reconciles it"
        );

        assert!(!inspect_mood_tags_backfill(&store).unwrap().needed);
    }

    #[test]
    fn backfill_v3_trusts_marked_top_level_moods_beside_native_tags() {
        let store = LibraryStore::open_in_memory();

        let mut track = track_with_moods("t1");
        track.raw_json = r#"{
            "_psysonicMoodsAuthoritative": true,
            "moods": ["Atmospheric", "Dreamy"],
            "tags": {
                "genre": ["Ambient"]
            }
        }"#
        .into();

        TrackRepository::new(&store).upsert_batch(&[track]).unwrap();

        store
            .with_conn_mut("test.simulate_marked_v2_projection_gap", |conn| {
                conn.execute("DELETE FROM track_mood", [])?;
                conn.execute(
                    "INSERT INTO library_data_migration
                         (id, cursor_rowid, started_at, completed_at)
                     VALUES ('mood_tags_v2', 1, 1, 1)",
                    [],
                )?;
                Ok(())
            })
            .unwrap();

        run_mood_tags_backfill_impl(&store, None).unwrap();

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

        assert_eq!(moods, vec!["Atmospheric".to_string(), "Dreamy".to_string()]);
        assert!(!inspect_mood_tags_backfill(&store).unwrap().needed);
    }

    #[test]
    fn delete_under_v2_does_not_resurrect_stale_top_level_mood_on_v3_upgrade() {
        let store = LibraryStore::open_in_memory();

        let mut track = track_with_moods("t1");
        track.raw_json = r#"{
            "moods": ["Atmospheric"],
            "tags": {
                "mood": ["Atmospheric"],
                "genre": ["Ambient"]
            }
        }"#
        .into();

        TrackRepository::new(&store).upsert_batch(&[track]).unwrap();

        store
            .with_conn_mut("test.simulate_v2_native_mood_delete", |conn| {
                // #1697/v2 treated the native tags snapshot as authoritative:
                // a real server-side deletion removed tags.mood and the
                // projection, but the older top-level moods field survived
                // the sparse JSON merge.
                conn.execute(
                    "UPDATE track
                     SET raw_json = json_remove(raw_json, '$.tags.mood')
                     WHERE server_id = 's1' AND id = 't1'",
                    [],
                )?;
                conn.execute(
                    "DELETE FROM track_mood
                     WHERE server_id = 's1' AND track_id = 't1'",
                    [],
                )?;
                conn.execute(
                    "INSERT INTO library_data_migration
                         (id, cursor_rowid, started_at, completed_at)
                     VALUES ('mood_tags_v2', 1, 1, 1)",
                    [],
                )?;
                Ok(())
            })
            .unwrap();

        run_mood_tags_backfill_impl(&store, None).unwrap();

        let mood_count: i64 = store
            .with_read_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*)
                     FROM track_mood
                     WHERE server_id = 's1' AND track_id = 't1'",
                    [],
                    |row| row.get(0),
                )
            })
            .unwrap();

        assert_eq!(
            mood_count, 0,
            "v3 must not resurrect a mood that v2 authoritatively cleared"
        );
        assert!(!inspect_mood_tags_backfill(&store).unwrap().needed);
    }

    #[test]
    fn native_id_migration_rebuilds_moods_with_canonical_track_and_album_ownership() {
        let store = LibraryStore::open_in_memory();
        let legacy_track = "e3b7fc2ae9447bbec37a13bf916e3cf6";
        let legacy_album = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
        let legacy_library = "00112233445566778899aabbccddeeff";

        let mut moving = track_with_moods(legacy_track);
        moving.album_id = Some(legacy_album.into());
        moving.library_id = Some(legacy_library.into());
        let mut stable = track_with_moods("stable-track");
        stable.album_id = Some(legacy_album.into());
        stable.library_id = Some(legacy_library.into());
        let mut other_server = track_with_moods("other-song");
        other_server.server_id = "s2".into();
        TrackRepository::new(&store)
            .upsert_batch(&[moving, stable, other_server])
            .unwrap();
        store
            .with_conn_mut("test.seed_native_album", |conn| {
                conn.execute(
                    "INSERT INTO album (server_id, id, name, synced_at, raw_json) \
                     VALUES ('s1', ?1, 'Test Album', 1, ?2)",
                    params![
                        legacy_album,
                        serde_json::json!({ "id": legacy_album, "name": "Test Album" }).to_string()
                    ],
                )?;
                Ok(())
            })
            .unwrap();

        // The original projection was marked complete before Navidrome changed IDs.
        run_mood_tags_backfill_impl(&store, None).unwrap();
        assert!(!inspect_mood_tags_backfill(&store).unwrap().needed);

        for step in [
            NavidromeNativeMigrationStep::Album,
            NavidromeNativeMigrationStep::Track,
        ] {
            let upper = upper_rowid(&store, "s1", step).unwrap();
            run_batch(&store, "s1", step, 0, upper, 100).unwrap();
        }
        finalize(&store, "s1").unwrap();

        assert!(inspect_mood_tags_backfill(&store).unwrap().needed);
        let stale_rows: i64 = store
            .with_read_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM track_mood WHERE server_id = 's1'",
                    [],
                    |r| r.get(0),
                )
            })
            .unwrap();
        assert_eq!(stale_rows, 0);

        run_mood_tags_backfill_impl(&store, None).unwrap();

        let rows: Vec<(String, String, String)> = store
            .with_read_conn(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT track_id, album_id, library_id FROM track_mood \
                     WHERE server_id = 's1' AND mood = 'Atmospheric' ORDER BY track_id",
                )?;
                let rows = stmt
                    .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .unwrap();
        let mut expected = vec![
            (
                canonical_id(legacy_track),
                canonical_id(legacy_album),
                canonical_id(legacy_library),
            ),
            (
                "stable-track".into(),
                canonical_id(legacy_album),
                canonical_id(legacy_library),
            ),
        ];
        expected.sort_by(|left, right| left.0.cmp(&right.0));
        assert_eq!(rows, expected);
        let other_server_moods: i64 = store
            .with_read_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM track_mood WHERE server_id = 's2' AND track_id = 'other-song'",
                    [],
                    |row| row.get(0),
                )
            })
            .unwrap();
        assert_eq!(other_server_moods, 3);
        assert!(!inspect_mood_tags_backfill(&store).unwrap().needed);
    }
}
