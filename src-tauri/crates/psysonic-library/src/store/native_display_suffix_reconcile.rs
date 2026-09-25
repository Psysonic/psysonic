use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use super::{LibraryBackfillStep, LibraryStore};
use crate::browse_projection::AlbumScope;
use crate::sync::mapping::{album_version_from_tags, append_navidrome_suffix, subtitle_from_tags};

/// One-time repair for rows ingested from Navidrome's native `/api/song` before
/// the mapper appended the track subtitle to the title and the album version to
/// the album name the way Navidrome's Subsonic API does (issue #1638). Without it
/// those rows keep the bare text until the server changes them.
///
/// `append_navidrome_suffix` leaves a value that already ends with the suffix
/// alone, so rows that came through the Subsonic path are never touched.
pub(crate) const NATIVE_DISPLAY_SUFFIX_BACKFILL_RECONCILE_ID: &str =
    "native_display_suffix_backfill_v1";
/// Rowid span covered per scheduler tick. Only rows whose JSON mentions either tag
/// are read, so a span this wide costs about 50–130 ms on a 160k-track library
/// (measured on a copy) and the whole pass finishes in a few minutes.
const NATIVE_DISPLAY_SUFFIX_BACKFILL_ROWID_WINDOW: i64 = 10_000;

fn native_display_suffix_backfill_completed(conn: &Connection) -> rusqlite::Result<bool> {
    let completed: Option<Option<i64>> = conn
        .query_row(
            "SELECT completed_at FROM library_data_migration WHERE id = ?1",
            params![NATIVE_DISPLAY_SUFFIX_BACKFILL_RECONCILE_ID],
            |row| row.get(0),
        )
        .optional()?;
    Ok(completed.flatten().is_some())
}

struct BackfillRow {
    rowid: i64,
    server_id: String,
    track_id: String,
    title: String,
    album: String,
    album_id: Option<String>,
    library_id: Option<String>,
    raw_json: String,
}

fn reconcile_native_display_suffix_backfill_batch(
    conn: &Connection,
) -> rusqlite::Result<LibraryBackfillStep> {
    if native_display_suffix_backfill_completed(conn)? {
        return Ok(LibraryBackfillStep::Complete);
    }
    conn.execute(
        "INSERT INTO library_data_migration (id, cursor_rowid, started_at) \
         VALUES (?1, 0, strftime('%s','now')) \
         ON CONFLICT(id) DO UPDATE SET \
           started_at = COALESCE(library_data_migration.started_at, excluded.started_at)",
        params![NATIVE_DISPLAY_SUFFIX_BACKFILL_RECONCILE_ID],
    )?;

    let cursor: i64 = conn.query_row(
        "SELECT cursor_rowid FROM library_data_migration WHERE id = ?1",
        params![NATIVE_DISPLAY_SUFFIX_BACKFILL_RECONCILE_ID],
        |row| row.get(0),
    )?;
    let max_rowid: Option<i64> =
        conn.query_row("SELECT MAX(rowid) FROM track", [], |row| row.get(0))?;
    if max_rowid.is_none_or(|max_rowid| max_rowid <= cursor) {
        conn.execute(
            "UPDATE library_data_migration \
             SET completed_at = strftime('%s','now') WHERE id = ?1",
            params![NATIVE_DISPLAY_SUFFIX_BACKFILL_RECONCILE_ID],
        )?;
        return Ok(LibraryBackfillStep::Complete);
    }
    let window_end = cursor.saturating_add(NATIVE_DISPLAY_SUFFIX_BACKFILL_ROWID_WINDOW);
    let rows = {
        let mut stmt = conn.prepare(
            "SELECT rowid, server_id, id, title, album, album_id, library_id, raw_json \
             FROM track WHERE rowid > ?1 AND rowid <= ?2 AND deleted = 0 \
               AND (instr(raw_json, '\"subtitle\"') > 0 \
                    OR instr(raw_json, '\"albumversion\"') > 0) \
             ORDER BY rowid",
        )?;
        let rows = stmt
            .query_map(params![cursor, window_end], |row| {
                Ok(BackfillRow {
                    rowid: row.get(0)?,
                    server_id: row.get(1)?,
                    track_id: row.get(2)?,
                    title: row.get(3)?,
                    album: row.get(4)?,
                    album_id: row.get(5)?,
                    library_id: row.get(6)?,
                    raw_json: row.get(7)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let tx = conn.unchecked_transaction()?;
    let mut changed_tracks: Vec<(String, String)> = Vec::new();
    let mut changed_scopes: HashSet<AlbumScope> = HashSet::new();
    for row in rows {
        let Ok(raw) = serde_json::from_str::<Value>(&row.raw_json) else {
            continue;
        };
        let title = append_navidrome_suffix(&row.title, subtitle_from_tags(&raw).as_deref());
        let album = if row.album.is_empty() {
            row.album.clone()
        } else {
            append_navidrome_suffix(&row.album, album_version_from_tags(&raw))
        };
        if title == row.title && album == row.album {
            continue;
        }
        tx.execute(
            "UPDATE track SET title = ?2, album = ?3 WHERE rowid = ?1",
            params![row.rowid, title, album],
        )?;
        if let Some(album_id) = row.album_id.filter(|id| !id.is_empty()) {
            changed_scopes.insert((
                row.server_id.clone(),
                row.library_id.unwrap_or_default(),
                album_id,
            ));
        }
        changed_tracks.push((row.server_id, row.track_id));
    }
    if !changed_tracks.is_empty() {
        crate::identity::record_tracks(
            &tx,
            changed_tracks
                .iter()
                .map(|(server_id, track_id)| (server_id.as_str(), track_id.as_str())),
        )?;
        crate::identity::record_album_scopes(&tx, &changed_scopes)?;
        crate::browse_projection::refresh_album_scopes(&tx, changed_scopes)?;
    }
    tx.execute(
        "UPDATE library_data_migration SET cursor_rowid = ?2 WHERE id = ?1",
        params![NATIVE_DISPLAY_SUFFIX_BACKFILL_RECONCILE_ID, window_end],
    )?;
    tx.commit()?;
    Ok(LibraryBackfillStep::Pending)
}

impl LibraryStore {
    /// Append the Navidrome subtitle / album version to one physical-row batch of
    /// natively ingested tracks. The background scheduler calls this only while idle.
    pub fn run_native_display_suffix_backfill_batch(&self) -> Result<LibraryBackfillStep, String> {
        if self.bulk_ingest_active() {
            return Ok(LibraryBackfillStep::Deferred);
        }
        self.with_conn("native_display_suffix_reconcile.batch", |conn| {
            if self.bulk_ingest_active() {
                return Ok(LibraryBackfillStep::Deferred);
            }
            reconcile_native_display_suffix_backfill_batch(conn)
        })
    }
}

/// Test helper that drains every batch without scheduler delays.
#[cfg(test)]
pub(super) fn maybe_reconcile_native_display_suffix_backfill(
    conn: &Connection,
) -> rusqlite::Result<()> {
    loop {
        if reconcile_native_display_suffix_backfill_batch(conn)? == LibraryBackfillStep::Complete {
            return Ok(());
        }
    }
}
