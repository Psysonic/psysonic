//! One-time blocking backfill: populate `track_mood` from existing `track` rows.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Emitter};

use crate::mood_tags::{moods_for_track_extracted, replace_track_mood_rows};
use crate::store::LibraryStore;

pub const MOOD_TAGS_MIGRATION_ID: &str = "mood_tags_v1";

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

pub fn inspect_mood_tags_backfill(
    store: &LibraryStore,
) -> Result<MoodTagsInspectDto, String> {
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

fn emit_progress(
    app: &AppHandle,
    done: u64,
    total: u64,
) -> Result<(), String> {
    app.emit(
        "mood_tags:progress",
        MoodTagsProgressEvent { done, total },
    )
    .map_err(|e| e.to_string())
}

pub fn run_mood_tags_backfill(
    store: &LibraryStore,
    app: &AppHandle,
) -> Result<(), String> {
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

    loop {
        let (batch_done, finished) =
            store.with_conn_mut("mood_tags.backfill", |conn| {
                if migration_completed(conn)? {
                    return Ok::<(i64, bool), rusqlite::Error>((
                        total as i64,
                        true,
                    ));
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

                    return Ok((total as i64, true));
                }

                let tx = conn.unchecked_transaction()?;
                let mut last_rowid = cursor;

                for (
                    rowid,
                    server_id,
                    track_id,
                    moods_json,
                    album_id,
                    library_id,
                ) in rows
                {
                    let moods = moods_for_track_extracted(moods_json.as_deref());

                    replace_track_mood_rows(
                        &tx,
                        &server_id,
                        &track_id,
                        album_id.as_deref(),
                        library_id.as_deref(),
                        &moods,
                    )?;

                    last_rowid = rowid;
                }

                tx.commit()?;

                conn.execute(
                    "UPDATE library_data_migration
                     SET cursor_rowid = ?2
                     WHERE id = ?1",
                    params![MOOD_TAGS_MIGRATION_ID, last_rowid],
                )?;

                let done: i64 = conn.query_row(
                    "SELECT COUNT(*)
                     FROM track
                     WHERE deleted = 0
                       AND rowid <= ?1",
                    params![last_rowid],
                    |row| row.get(0),
                )?;

                Ok((done, false))
            })?;

        if let Some(app) = app {
            emit_progress(app, batch_done.max(0) as u64, total)?;
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
                conn.query_row(
                    "SELECT COUNT(*) FROM track_mood",
                    [],
                    |row| row.get(0),
                )
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
}