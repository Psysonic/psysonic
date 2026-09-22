//! Materialized OpenSubsonic artist credits maintained alongside album browse rows.

use std::collections::{BTreeMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::browse_projection::{logical_progress, AlbumScope, ScopeBrowseProjectionInspectDto};
use crate::store::LibraryStore;

pub const MIGRATION_ID: &str = "scope_browse_artist_credit_projection_v1";
const BACKFILL_BATCH_SIZE: i64 = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ArtistCredit {
    id: String,
    name: String,
    key: String,
    kind: &'static str,
}

fn trimmed_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn insert_credit(
    item: &Value,
    kind: &'static str,
    credits: &mut BTreeMap<(&'static str, String), ArtistCredit>,
) {
    let Some(id) = trimmed_string(item.get("id")) else {
        return;
    };
    let Some(name) = trimmed_string(item.get("name")) else {
        return;
    };
    let key = crate::identity::norm_part(&name).unwrap_or_else(|| name.to_lowercase());
    credits.entry((kind, id.clone())).or_insert(ArtistCredit {
        id,
        name,
        key,
        kind,
    });
}

fn extract_array_credits(
    raw: &Value,
    field: &str,
    kind: &'static str,
    credits: &mut BTreeMap<(&'static str, String), ArtistCredit>,
) {
    match raw.get(field) {
        Some(Value::Array(items)) => {
            for item in items {
                insert_credit(item, kind, credits);
            }
        }
        Some(item @ Value::Object(_)) => insert_credit(item, kind, credits),
        _ => {}
    }
}

fn extract_artist_credits(raw_json: &str) -> Vec<ArtistCredit> {
    let Ok(raw) = serde_json::from_str::<Value>(raw_json) else {
        return Vec::new();
    };
    let mut credits = BTreeMap::new();
    extract_array_credits(&raw, "artists", "track", &mut credits);
    extract_array_credits(&raw, "albumArtists", "album", &mut credits);
    credits.into_values().collect()
}

pub(crate) fn refresh_album_scopes(
    tx: &Transaction<'_>,
    scopes: &HashSet<AlbumScope>,
) -> rusqlite::Result<()> {
    let mut delete = tx.prepare_cached(
        "DELETE FROM artist_credit_projection \
         WHERE server_id = ?1 AND library_id = ?2 AND album_id = ?3",
    )?;
    let mut tracks = tx.prepare_cached(
        "SELECT id, artist_id, synced_at, raw_json FROM track \
         WHERE server_id = ?1 AND COALESCE(library_id, '') = ?2 AND album_id = ?3 \
           AND deleted = 0 ORDER BY id",
    )?;
    let mut insert = tx.prepare_cached(
        "INSERT INTO artist_credit_projection ( \
           server_id, library_id, track_id, album_id, artist_id, artist_name, \
           artist_key, credit_kind, is_primary, synced_at \
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;

    // Clear every affected partition before rebuilding any of them. A library-tag
    // pass can move a track between partitions, while the projection primary key
    // intentionally identifies the track credit independently of library_id.
    for (server_id, library_id, album_id) in scopes {
        delete.execute(params![server_id, library_id, album_id])?;
    }
    for (server_id, library_id, album_id) in scopes {
        let rows = tracks
            .query_map(params![server_id, library_id, album_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (track_id, primary_artist_id, synced_at, raw_json) in rows {
            for credit in extract_artist_credits(&raw_json) {
                insert.execute(params![
                    server_id,
                    library_id,
                    track_id,
                    album_id,
                    credit.id,
                    credit.name,
                    credit.key,
                    credit.kind,
                    i64::from(
                        primary_artist_id.as_deref().map(str::trim) == Some(credit.id.as_str()),
                    ),
                    synced_at,
                ])?;
            }
        }
    }
    Ok(())
}

pub(crate) fn rebuild_scope(
    tx: &Transaction<'_>,
    server_id: &str,
    library_scope: &str,
) -> rusqlite::Result<()> {
    if library_scope.is_empty() {
        tx.execute(
            "DELETE FROM artist_credit_projection WHERE server_id = ?1",
            params![server_id],
        )?;
    } else {
        tx.execute(
            "DELETE FROM artist_credit_projection WHERE server_id = ?1 AND library_id = ?2",
            params![server_id, library_scope],
        )?;
    }

    let sql = if library_scope.is_empty() {
        "SELECT DISTINCT COALESCE(library_id, ''), album_id FROM track \
         WHERE server_id = ?1 AND deleted = 0 AND album_id IS NOT NULL AND album_id != ''"
    } else {
        "SELECT DISTINCT COALESCE(library_id, ''), album_id FROM track \
         WHERE server_id = ?1 AND library_id = ?2 AND deleted = 0 \
           AND album_id IS NOT NULL AND album_id != ''"
    };
    let mut statement = tx.prepare(sql)?;
    let rows = if library_scope.is_empty() {
        statement
            .query_map(params![server_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        statement
            .query_map(params![server_id, library_scope], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    drop(statement);
    let scopes = rows
        .into_iter()
        .map(|(library_id, album_id)| (server_id.to_string(), library_id, album_id))
        .collect();
    refresh_album_scopes(tx, &scopes)
}

fn migration_completed(conn: &Connection) -> rusqlite::Result<bool> {
    let completed: Option<Option<i64>> = conn
        .query_row(
            "SELECT completed_at FROM library_data_migration WHERE id = ?1",
            params![MIGRATION_ID],
            |row| row.get(0),
        )
        .optional()?;
    Ok(completed.flatten().is_some())
}

fn cursor_rowid(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT cursor_rowid FROM library_data_migration WHERE id = ?1",
        params![MIGRATION_ID],
        |row| row.get(0),
    )
    .optional()
    .map(|cursor| cursor.unwrap_or(0))
}

pub(crate) fn inspect(store: &LibraryStore) -> Result<ScopeBrowseProjectionInspectDto, String> {
    store
        .with_read_conn(|conn| {
            let total: i64 =
                conn.query_row("SELECT COUNT(*) FROM track WHERE deleted = 0", [], |row| {
                    row.get(0)
                })?;
            if total == 0 || migration_completed(conn)? {
                return Ok(ScopeBrowseProjectionInspectDto {
                    needed: false,
                    total_tracks: total.max(0) as u64,
                    done_tracks: total.max(0) as u64,
                });
            }
            let cursor = cursor_rowid(conn)?;
            let done: i64 = conn.query_row(
                "SELECT COUNT(*) FROM track WHERE deleted = 0 AND rowid <= ?1",
                params![cursor],
                |row| row.get(0),
            )?;
            Ok(ScopeBrowseProjectionInspectDto {
                needed: true,
                total_tracks: total.max(0) as u64,
                done_tracks: done.max(0) as u64,
            })
        })
        .map_err(|error| error.to_string())
}

#[cfg(test)]
pub(crate) fn run_backfill(store: &LibraryStore, app: Option<&AppHandle>) -> Result<(), String> {
    let inspect_result = inspect(store)?;
    let progress_total = if inspect_result.needed {
        inspect_result.total_tracks
    } else {
        0
    };
    run_backfill_with_progress(store, app, 0, progress_total, progress_total)
}

pub(crate) fn run_backfill_with_progress(
    store: &LibraryStore,
    app: Option<&AppHandle>,
    progress_offset: u64,
    progress_total: u64,
    total_tracks: u64,
) -> Result<(), String> {
    let inspect_result = inspect(store)?;
    if !inspect_result.needed {
        return Ok(());
    }
    loop {
        let (done, finished) = store.with_conn_mut("artist_credit_projection.backfill", |conn| {
            if migration_completed(conn)? {
                return Ok((inspect_result.total_tracks, true));
            }
            conn.execute(
                "INSERT INTO library_data_migration (id, cursor_rowid, started_at) \
                 VALUES (?1, 0, strftime('%s','now')) ON CONFLICT(id) DO NOTHING",
                params![MIGRATION_ID],
            )?;
            let cursor = cursor_rowid(conn)?;
            let tx = conn.transaction()?;
            let rows = {
                let mut statement = tx.prepare(
                    "SELECT rowid, server_id, COALESCE(library_id, ''), album_id \
                     FROM track WHERE deleted = 0 AND rowid > ?1 ORDER BY rowid LIMIT ?2",
                )?;
                let mapped = statement.query_map(params![cursor, BACKFILL_BATCH_SIZE], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                })?;
                mapped.collect::<rusqlite::Result<Vec<_>>>()?
            };
            if let Some(last_rowid) = rows.last().map(|row| row.0) {
                let scopes = rows
                    .into_iter()
                    .filter_map(|(_, server_id, library_id, album_id)| {
                        album_id
                            .filter(|id| !id.is_empty())
                            .map(|album_id| (server_id, library_id, album_id))
                    })
                    .collect::<HashSet<_>>();
                refresh_album_scopes(&tx, &scopes)?;
                tx.execute(
                    "UPDATE library_data_migration SET cursor_rowid = ?2 WHERE id = ?1",
                    params![MIGRATION_ID, last_rowid],
                )?;
                tx.commit()?;
                let done: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM track WHERE deleted = 0 AND rowid <= ?1",
                    params![last_rowid],
                    |row| row.get(0),
                )?;
                Ok((done.max(0) as u64, false))
            } else {
                tx.execute(
                    "UPDATE library_data_migration SET completed_at = strftime('%s','now') WHERE id = ?1",
                    params![MIGRATION_ID],
                )?;
                tx.commit()?;
                Ok((inspect_result.total_tracks, true))
            }
        })?;
        if let Some(app) = app {
            app.emit(
                "scope_browse_projection:progress",
                logical_progress(
                    progress_offset.saturating_add(done),
                    progress_total,
                    total_tracks,
                ),
            )
            .map_err(|error| error.to_string())?;
        }
        if finished {
            return Ok(());
        }
    }
}

#[cfg(test)]
#[path = "artist_credit_projection_tests.rs"]
mod tests;
