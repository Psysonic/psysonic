//! Materialized composer credits maintained alongside album browse rows.

use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::artist_sort::{sort_key_for_display_name, DEFAULT_IGNORED_ARTICLES};
use crate::browse_projection::{
    AlbumScope, ScopeBrowseProjectionInspectDto, ScopeBrowseProjectionProgressEvent,
};
use crate::store::LibraryStore;

pub const MIGRATION_ID: &str = "scope_browse_composer_projection_v1";
const BACKFILL_BATCH_SIZE: i64 = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ComposerCredit {
    id: String,
    name: String,
}

fn trimmed_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_composer_credits(raw_json: &str) -> Vec<ComposerCredit> {
    let Ok(raw) = serde_json::from_str::<Value>(raw_json) else {
        return Vec::new();
    };
    let Some(contributors) = raw.get("contributors").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut credits = BTreeMap::<String, String>::new();
    for contributor in contributors {
        let Some(role) = trimmed_string(contributor.get("role")) else {
            continue;
        };
        if !role.eq_ignore_ascii_case("composer") {
            continue;
        }
        let artist = contributor.get("artist");
        let id = artist
            .and_then(|value| trimmed_string(value.get("id")))
            .or_else(|| trimmed_string(contributor.get("artistId")));
        let name = artist
            .and_then(|value| trimmed_string(value.get("name")))
            .or_else(|| trimmed_string(contributor.get("name")));
        if let (Some(id), Some(name)) = (id, name) {
            credits.entry(id).or_insert(name);
        }
    }
    credits
        .into_iter()
        .map(|(id, name)| ComposerCredit { id, name })
        .collect()
}

fn identity_key(name: &str) -> String {
    crate::identity::norm_part(name).unwrap_or_else(|| name.trim().to_lowercase())
}

fn insert_credit(
    insert: &mut rusqlite::CachedStatement<'_>,
    server_id: &str,
    library_id: &str,
    album_id: &str,
    credit: &ComposerCredit,
    synced_at: i64,
    track_id: &str,
) -> rusqlite::Result<()> {
    insert.execute(params![
        server_id,
        library_id,
        credit.id,
        credit.name,
        sort_key_for_display_name(&credit.name, DEFAULT_IGNORED_ARTICLES),
        identity_key(&credit.name),
        album_id,
        synced_at,
        track_id,
    ])?;
    Ok(())
}

fn reconcile_composer_metadata(
    tx: &Transaction<'_>,
    composers: HashSet<(String, String)>,
) -> rusqlite::Result<()> {
    let mut canonical = tx.prepare_cached(
        "SELECT composer_name FROM composer_album_projection \
         WHERE server_id = ?1 AND composer_id = ?2 \
         ORDER BY synced_at DESC, representative_track_id, album_id LIMIT 1",
    )?;
    let mut update = tx.prepare_cached(
        "UPDATE composer_album_projection \
         SET composer_name = ?3, name_sort = ?4, identity_key = ?5 \
         WHERE server_id = ?1 AND composer_id = ?2",
    )?;
    for (server_id, composer_id) in composers {
        let name: String =
            canonical.query_row(params![server_id, composer_id], |row| row.get(0))?;
        update.execute(params![
            server_id,
            composer_id,
            name,
            sort_key_for_display_name(&name, DEFAULT_IGNORED_ARTICLES),
            identity_key(&name),
        ])?;
    }
    Ok(())
}

pub(crate) fn refresh_album_scopes(
    tx: &Transaction<'_>,
    scopes: &HashSet<AlbumScope>,
) -> rusqlite::Result<()> {
    let mut delete = tx.prepare_cached(
        "DELETE FROM composer_album_projection \
         WHERE server_id = ?1 AND library_id = ?2 AND album_id = ?3",
    )?;
    let mut tracks = tx.prepare_cached(
        "SELECT id, synced_at, raw_json FROM track \
         WHERE server_id = ?1 AND COALESCE(library_id, '') = ?2 AND album_id = ?3 \
           AND deleted = 0 ORDER BY id",
    )?;
    let mut insert = tx.prepare_cached(
        "INSERT INTO composer_album_projection ( \
           server_id, library_id, composer_id, composer_name, name_sort, identity_key, \
           album_id, synced_at, representative_track_id \
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;
    let mut affected_composers = HashSet::new();

    for (server_id, library_id, album_id) in scopes {
        delete.execute(params![server_id, library_id, album_id])?;
        let rows = tracks
            .query_map(params![server_id, library_id, album_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut composers = BTreeMap::<String, (ComposerCredit, i64, String)>::new();
        for (track_id, synced_at, raw_json) in rows {
            for credit in extract_composer_credits(&raw_json) {
                match composers.entry(credit.id.clone()) {
                    Entry::Vacant(entry) => {
                        entry.insert((credit, synced_at, track_id.clone()));
                    }
                    Entry::Occupied(mut entry)
                        if synced_at > entry.get().1
                            || (synced_at == entry.get().1 && track_id < entry.get().2) =>
                    {
                        entry.insert((credit, synced_at, track_id.clone()));
                    }
                    Entry::Occupied(_) => {}
                }
            }
        }
        for (_, (credit, synced_at, track_id)) in composers {
            affected_composers.insert((server_id.clone(), credit.id.clone()));
            insert_credit(
                &mut insert,
                server_id,
                library_id,
                album_id,
                &credit,
                synced_at,
                &track_id,
            )?;
        }
    }
    drop(insert);
    reconcile_composer_metadata(tx, affected_composers)?;
    Ok(())
}

pub(crate) fn rebuild_scope(
    tx: &Transaction<'_>,
    server_id: &str,
    library_scope: &str,
) -> rusqlite::Result<()> {
    if library_scope.is_empty() {
        tx.execute(
            "DELETE FROM composer_album_projection WHERE server_id = ?1",
            params![server_id],
        )?;
    } else {
        tx.execute(
            "DELETE FROM composer_album_projection WHERE server_id = ?1 AND library_id = ?2",
            params![server_id, library_scope],
        )?;
    }

    let sql = if library_scope.is_empty() {
        "SELECT COALESCE(library_id, ''), album_id, id, synced_at, raw_json \
         FROM track WHERE server_id = ?1 AND deleted = 0 \
           AND album_id IS NOT NULL AND album_id != '' \
         ORDER BY COALESCE(library_id, ''), album_id, id"
    } else {
        "SELECT COALESCE(library_id, ''), album_id, id, synced_at, raw_json \
         FROM track WHERE server_id = ?1 AND library_id = ?2 AND deleted = 0 \
           AND album_id IS NOT NULL AND album_id != '' \
         ORDER BY album_id, id"
    };
    let mut statement = tx.prepare(sql)?;
    let rows = if library_scope.is_empty() {
        statement
            .query_map(params![server_id], map_rebuild_track)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        statement
            .query_map(params![server_id, library_scope], map_rebuild_track)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    drop(statement);

    let mut composers = BTreeMap::<(String, String, String), (ComposerCredit, i64, String)>::new();
    for (library_id, album_id, track_id, synced_at, raw_json) in rows {
        for credit in extract_composer_credits(&raw_json) {
            let key = (library_id.clone(), album_id.clone(), credit.id.clone());
            match composers.entry(key) {
                Entry::Vacant(entry) => {
                    entry.insert((credit, synced_at, track_id.clone()));
                }
                Entry::Occupied(mut entry)
                    if synced_at > entry.get().1
                        || (synced_at == entry.get().1 && track_id < entry.get().2) =>
                {
                    entry.insert((credit, synced_at, track_id.clone()));
                }
                Entry::Occupied(_) => {}
            }
        }
    }
    let mut insert = tx.prepare_cached(
        "INSERT INTO composer_album_projection ( \
           server_id, library_id, composer_id, composer_name, name_sort, identity_key, \
           album_id, synced_at, representative_track_id \
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;
    let mut affected_composers = HashSet::new();
    for ((library_id, album_id, _), (credit, synced_at, track_id)) in composers {
        affected_composers.insert((server_id.to_string(), credit.id.clone()));
        insert_credit(
            &mut insert,
            server_id,
            &library_id,
            &album_id,
            &credit,
            synced_at,
            &track_id,
        )?;
    }
    drop(insert);
    reconcile_composer_metadata(tx, affected_composers)?;
    Ok(())
}

fn map_rebuild_track(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(String, String, String, i64, String)> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
    ))
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

pub(crate) fn run_backfill(store: &LibraryStore, app: Option<&AppHandle>) -> Result<(), String> {
    let inspect_result = inspect(store)?;
    if !inspect_result.needed {
        return Ok(());
    }
    loop {
        let (done, finished) = store.with_conn_mut("composer_projection.backfill", |conn| {
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
                let mut stmt = tx.prepare(
                    "SELECT rowid, server_id, COALESCE(library_id, ''), album_id \
                     FROM track WHERE deleted = 0 AND rowid > ?1 ORDER BY rowid LIMIT ?2",
                )?;
                let mapped = stmt.query_map(params![cursor, BACKFILL_BATCH_SIZE], |row| {
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
                ScopeBrowseProjectionProgressEvent {
                    done,
                    total: inspect_result.total_tracks,
                },
            )
            .map_err(|error| error.to_string())?;
        }
        if finished {
            return Ok(());
        }
    }
}

#[cfg(test)]
#[path = "composer_projection_tests.rs"]
mod tests;
