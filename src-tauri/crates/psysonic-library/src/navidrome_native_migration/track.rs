use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension, Transaction};

use super::{
    canonical_optional_artwork, canonical_optional_id, migration_error, record_mapping,
    BatchMutationStats,
};
use crate::navidrome_id_codec::{canonical_id, is_lossless_legacy_id};
use crate::navidrome_payload_codec::{
    canonical_payload, merge_canonical_payloads, NavidromePayloadKind,
};
use crate::repos::track::retarget::retarget_track_references;
use crate::repos::track::{row_to_track_row_at, track_columns, TrackRow, UPSERT_SQL};

#[derive(Debug, Clone)]
struct TrackOwner {
    rowid: i64,
    row: TrackRow,
}

pub(super) fn preflight(tx: &Transaction<'_>, server_id: &str) -> rusqlite::Result<u64> {
    let upper_rowid: i64 = tx.query_row(
        "SELECT COALESCE(MAX(rowid), 0) FROM track WHERE server_id = ?1",
        params![server_id],
        |row| row.get(0),
    )?;
    let mut cursor_rowid = 0;
    let mut scanned = 0u64;
    loop {
        let rows = load_batch(
            tx,
            server_id,
            cursor_rowid,
            upper_rowid,
            super::MAX_BATCH_LIMIT,
        )?;
        let Some(last_rowid) = rows.last().map(|row| row.rowid) else {
            break;
        };
        for source in &rows {
            canonical_payload(
                Some(source.row.raw_json.as_str()),
                NavidromePayloadKind::Track,
            )
            .map_err(migration_error)?;
            let destination_id = migration_destination_id(tx, server_id, &source.row.id)?;
            if source.row.id != destination_id {
                if let Some(destination) = load_owner(tx, server_id, &destination_id)?
                    .filter(|destination| !destination.row.deleted)
                {
                    ensure_merge_safe(
                        tx,
                        server_id,
                        &destination.row,
                        &source.row,
                        &destination_id,
                    )?;
                }
            }
        }
        scanned = scanned.saturating_add(rows.len() as u64);
        cursor_rowid = last_rowid;
        if cursor_rowid >= upper_rowid {
            break;
        }
    }
    Ok(scanned)
}

pub(super) fn run_batch(
    tx: &Transaction<'_>,
    server_id: &str,
    cursor_rowid: i64,
    upper_rowid: i64,
    limit: u32,
) -> rusqlite::Result<BatchMutationStats> {
    // Finalization rebuilds FTS, so avoid maintaining stale entries during the rewrite.
    crate::track_fts::suspend_track_fts_triggers(tx)?;
    let rows = load_batch(tx, server_id, cursor_rowid, upper_rowid, limit)?;
    prepare_fast_track_mapping(tx)?;
    for owner in &rows {
        record_mapping(
            tx,
            "track",
            owner.rowid,
            &owner.row.id,
            &canonical_id(&owner.row.id),
        )?;
    }
    let preserved_reference_ids = load_preserved_reference_ids(tx, server_id)?;
    let existing_destination_ids = load_existing_destination_ids(tx, server_id)?;
    let remapped_at = now_unix_ms();

    let mut stats = BatchMutationStats::default();
    for selected in rows {
        stats.processed += 1;
        stats.last_rowid = selected.rowid;
        let requires_full_retarget = preserved_reference_ids.contains(&selected.row.id);
        let source = if requires_full_retarget {
            let Some(source) = load_owner(tx, server_id, &selected.row.id)? else {
                continue;
            };
            source
        } else {
            selected
        };
        let old_id = source.row.id.clone();
        let destination_id = migration_destination_id(tx, server_id, &source.row.id)?;
        if old_id == destination_id {
            let row = canonicalize_owner(source.row, destination_id)?;
            write_owner(tx, &row)?;
            continue;
        }

        let destination = if existing_destination_ids.contains(&destination_id) {
            load_owner(tx, server_id, &destination_id)?
        } else {
            None
        };
        let replaces_deleted_owner = destination
            .as_ref()
            .is_some_and(|destination| destination.row.deleted);
        // The canonical row owns the migrated ID. Keep it and retarget legacy
        // references even when mutable server metadata has changed.
        let row = match destination.filter(|destination| !destination.row.deleted) {
            Some(destination) => {
                ensure_merge_safe(
                    tx,
                    server_id,
                    &destination.row,
                    &source.row,
                    &destination_id,
                )?;
                stats.merged += 1;
                merge_owner(destination.row, source.row, destination_id.clone())?
            }
            None => {
                stats.moved += 1;
                canonicalize_owner(source.row, destination_id.clone())?
            }
        };
        if replaces_deleted_owner {
            clear_deleted_owner_preserved_fields(tx, server_id, &destination_id)?;
        }
        write_owner(tx, &row)?;
        if requires_full_retarget {
            discard_stale_source_alias(tx, server_id, &old_id, &destination_id)?;
            retarget_track_references(
                tx,
                server_id,
                &old_id,
                &destination_id,
                row.content_hash.as_deref(),
                row.server_path.as_deref(),
                remapped_at,
            )?;
            verify_retarget(tx, server_id, &old_id, &destination_id)?;
        } else {
            record_fast_track_mapping(
                tx,
                &old_id,
                &destination_id,
                row.content_hash.as_deref(),
                row.server_path.as_deref(),
                remapped_at,
            )?;
        }
    }
    apply_fast_track_retargets(tx, server_id)?;
    crate::track_fts::restore_track_fts_triggers(tx)?;
    Ok(stats)
}

fn prepare_fast_track_mapping(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS navidrome_fast_track_mapping (
           old_id TEXT PRIMARY KEY,
           new_id TEXT NOT NULL,
           content_hash TEXT,
           server_path TEXT,
           remapped_at INTEGER NOT NULL
         ) WITHOUT ROWID;
         DELETE FROM navidrome_fast_track_mapping;",
    )
}

fn record_fast_track_mapping(
    tx: &Transaction<'_>,
    old_id: &str,
    new_id: &str,
    content_hash: Option<&str>,
    server_path: Option<&str>,
    remapped_at: i64,
) -> rusqlite::Result<()> {
    tx.prepare_cached(
        "INSERT INTO navidrome_fast_track_mapping \
         (old_id, new_id, content_hash, server_path, remapped_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?
    .execute(params![
        old_id,
        new_id,
        content_hash,
        server_path,
        remapped_at
    ])?;
    Ok(())
}

fn apply_fast_track_retargets(tx: &Transaction<'_>, server_id: &str) -> rusqlite::Result<()> {
    tx.execute(
        "DELETE FROM track_genre \
         WHERE server_id = ?1 AND track_id IN \
           (SELECT old_id FROM navidrome_fast_track_mapping)",
        params![server_id],
    )?;
    tx.execute(
        "INSERT INTO track_id_history \
         (server_id, old_id, new_id, content_hash, server_path, remapped_at) \
         SELECT ?1, old_id, new_id, content_hash, server_path, remapped_at \
         FROM navidrome_fast_track_mapping WHERE 1 \
         ON CONFLICT(server_id, old_id) DO UPDATE SET \
           new_id = excluded.new_id, \
           content_hash = COALESCE(NULLIF(excluded.content_hash, ''), track_id_history.content_hash), \
           server_path = COALESCE(NULLIF(excluded.server_path, ''), track_id_history.server_path), \
           remapped_at = MAX(track_id_history.remapped_at, excluded.remapped_at)",
        params![server_id],
    )?;
    tx.execute(
        "DELETE FROM track \
         WHERE server_id = ?1 AND id IN \
           (SELECT old_id FROM navidrome_fast_track_mapping)",
        params![server_id],
    )?;
    Ok(())
}

fn load_preserved_reference_ids(
    tx: &Transaction<'_>,
    server_id: &str,
) -> rusqlite::Result<HashSet<String>> {
    let mut statement = tx.prepare(
        "SELECT mapping.old_id \
         FROM navidrome_id_batch_mapping AS mapping \
         WHERE mapping.entity_kind = 'track' AND ( \
           EXISTS(SELECT 1 FROM track_offline \
             WHERE server_id = ?1 AND track_id = mapping.old_id) OR \
           EXISTS(SELECT 1 FROM track_extension \
             WHERE server_id = ?1 AND track_id = mapping.old_id) OR \
           EXISTS(SELECT 1 FROM track_fact \
             WHERE server_id = ?1 AND track_id = mapping.old_id) OR \
           EXISTS(SELECT 1 FROM track_artifact \
             WHERE server_id = ?1 AND track_id = mapping.old_id) OR \
           EXISTS(SELECT 1 FROM track_canonical_link \
             WHERE server_id = ?1 AND track_id = mapping.old_id) OR \
           EXISTS(SELECT 1 FROM canonical_enrichment_link \
             WHERE owner_server_id = ?1 AND owner_track_id = mapping.old_id) OR \
           EXISTS(SELECT 1 FROM play_session \
             WHERE server_id = ?1 AND track_id = mapping.old_id) OR \
           EXISTS(SELECT 1 FROM entity_user_rating \
             WHERE server_id = ?1 AND entity_kind = 'track' \
               AND entity_id = mapping.old_id) OR \
           EXISTS(SELECT 1 FROM track_id_history \
             WHERE server_id = ?1 AND old_id = mapping.old_id) OR \
           EXISTS(SELECT 1 FROM track_id_history \
             WHERE server_id = ?1 AND new_id = mapping.old_id) OR \
           EXISTS(SELECT 1 FROM navidrome_id_batch_mapping AS source \
             WHERE source.entity_kind = 'track' AND source.old_id != mapping.old_id \
               AND source.new_id = mapping.old_id) OR \
           EXISTS(SELECT 1 FROM navidrome_id_batch_mapping AS destination \
             WHERE destination.entity_kind = 'track' \
               AND destination.old_id = mapping.new_id \
               AND destination.old_id != destination.new_id) \
         )",
    )?;
    let rows = statement
        .query_map(params![server_id], |row| row.get(0))?
        .collect();
    rows
}

fn load_existing_destination_ids(
    tx: &Transaction<'_>,
    server_id: &str,
) -> rusqlite::Result<HashSet<String>> {
    let mut statement = tx.prepare(
        "SELECT mapping.new_id \
         FROM navidrome_id_batch_mapping AS mapping \
         JOIN track AS destination \
           ON destination.server_id = ?1 AND destination.id = mapping.new_id \
         WHERE mapping.entity_kind = 'track' AND mapping.old_id != mapping.new_id \
         UNION \
         SELECT new_id FROM navidrome_id_batch_mapping \
         WHERE entity_kind = 'track' AND old_id != new_id \
         GROUP BY new_id HAVING COUNT(*) > 1 \
         UNION \
         SELECT history.new_id FROM track_id_history AS history \
         JOIN track AS destination \
            ON destination.server_id = history.server_id \
           AND destination.id = history.new_id AND destination.deleted = 0 \
         WHERE history.server_id = ?1",
    )?;
    let rows = statement
        .query_map(params![server_id], |row| row.get(0))?
        .collect();
    rows
}

fn migration_destination_id(
    tx: &Transaction<'_>,
    server_id: &str,
    old_id: &str,
) -> rusqlite::Result<String> {
    let existing_owner = tx
        .query_row(
            "SELECT history.new_id FROM track_id_history AS history \
             JOIN track AS destination \
                ON destination.server_id = history.server_id \
               AND destination.id = history.new_id AND destination.deleted = 0 \
              WHERE history.server_id = ?1 AND history.old_id = ?2",
            params![server_id, old_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(existing_owner.unwrap_or_else(|| canonical_id(old_id)))
}

fn discard_stale_source_alias(
    tx: &Transaction<'_>,
    server_id: &str,
    old_id: &str,
    destination_id: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "DELETE FROM track_id_history AS history \
         WHERE history.server_id = ?1 AND history.old_id = ?2 \
           AND history.new_id != ?3 \
           AND NOT EXISTS( \
             SELECT 1 FROM track AS destination \
             WHERE destination.server_id = history.server_id \
               AND destination.id = history.new_id AND destination.deleted = 0 \
           )",
        params![server_id, old_id, destination_id],
    )?;
    Ok(())
}

fn load_batch(
    tx: &Transaction<'_>,
    server_id: &str,
    cursor_rowid: i64,
    upper_rowid: i64,
    limit: u32,
) -> rusqlite::Result<Vec<TrackOwner>> {
    let sql = format!(
        "SELECT rowid, {} FROM track \
         WHERE server_id = ?1 AND rowid > ?2 AND rowid <= ?3 \
         ORDER BY rowid LIMIT ?4",
        track_columns()
    );
    let mut statement = tx.prepare(&sql)?;
    let rows = statement
        .query_map(
            params![server_id, cursor_rowid, upper_rowid, i64::from(limit)],
            |row| {
                Ok(TrackOwner {
                    rowid: row.get(0)?,
                    row: row_to_track_row_at(row, 1)?,
                })
            },
        )?
        .collect();
    rows
}

fn load_owner(
    tx: &Transaction<'_>,
    server_id: &str,
    id: &str,
) -> rusqlite::Result<Option<TrackOwner>> {
    let sql = format!(
        "SELECT rowid, {} FROM track WHERE server_id = ?1 AND id = ?2",
        track_columns()
    );
    tx.prepare_cached(&sql)?
        .query_row(params![server_id, id], |row| {
            Ok(TrackOwner {
                rowid: row.get(0)?,
                row: row_to_track_row_at(row, 1)?,
            })
        })
        .optional()
}

fn ensure_merge_safe(
    tx: &Transaction<'_>,
    server_id: &str,
    destination: &TrackRow,
    source: &TrackRow,
    destination_id: &str,
) -> rusqlite::Result<()> {
    if is_lossless_legacy_id(&source.id) {
        return Ok(());
    }

    let mut matched_strong_id = false;
    for (label, destination_value, source_value) in [
        (
            "content_hash",
            destination.content_hash.as_deref(),
            source.content_hash.as_deref(),
        ),
        ("isrc", destination.isrc.as_deref(), source.isrc.as_deref()),
        (
            "mbid_recording",
            destination.mbid_recording.as_deref(),
            source.mbid_recording.as_deref(),
        ),
    ] {
        if let (Some(destination_value), Some(source_value)) = (
            destination_value.filter(|value| !value.is_empty()),
            source_value.filter(|value| !value.is_empty()),
        ) {
            if destination_value != source_value {
                return Err(migration_error(format!(
                    "contradictory Navidrome track collision field `{label}` for `{}` -> `{}`",
                    source.id, destination.id
                )));
            }
            matched_strong_id = true;
        }
    }

    let historical_owner: bool = !destination.deleted
        && tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM track_id_history \
         WHERE server_id = ?1 AND old_id = ?2 AND new_id = ?3)",
            params![server_id, source.id, destination_id],
            |row| row.get(0),
        )?;
    let stable_metadata_matches = source.duration_sec > 0
        && destination.duration_sec == source.duration_sec
        && matches!(
            (destination.size_bytes, source.size_bytes),
            (Some(destination_size), Some(source_size))
                if destination_size > 0 && destination_size == source_size
        )
        && !source.title.trim().is_empty()
        && destination.title == source.title
        && destination.album == source.album;
    if matched_strong_id || historical_owner || stable_metadata_matches {
        Ok(())
    } else {
        Err(migration_error(format!(
            "unproven Navidrome track collision `{}` -> `{}`",
            source.id, destination.id
        )))
    }
}

fn canonicalize_owner(mut row: TrackRow, destination_id: String) -> rusqlite::Result<TrackRow> {
    row.id = destination_id;
    row.artist_id = canonical_optional_id(row.artist_id);
    row.album_id = canonical_optional_id(row.album_id);
    row.library_id = canonical_optional_id(row.library_id);
    row.cover_art_id = canonical_optional_artwork(row.cover_art_id);
    row.raw_json = canonical_payload(Some(&row.raw_json), NavidromePayloadKind::Track)
        .map_err(migration_error)?
        .unwrap_or_default();
    Ok(row)
}

fn merge_owner(
    destination: TrackRow,
    source: TrackRow,
    destination_id: String,
) -> rusqlite::Result<TrackRow> {
    let source_is_newer = authority_timestamp(&source) > authority_timestamp(&destination);
    Ok(TrackRow {
        server_id: destination.server_id.clone(),
        id: destination_id,
        title: prefer_text(destination.title, source.title),
        title_sort: destination.title_sort.or(source.title_sort),
        artist: destination.artist.or(source.artist),
        artist_id: canonical_optional_id(destination.artist_id.or(source.artist_id)),
        album: prefer_text(destination.album, source.album),
        album_id: canonical_optional_id(destination.album_id.or(source.album_id)),
        album_artist: destination.album_artist.or(source.album_artist),
        duration_sec: if destination.duration_sec == 0 {
            source.duration_sec
        } else {
            destination.duration_sec
        },
        track_number: destination.track_number.or(source.track_number),
        disc_number: destination.disc_number.or(source.disc_number),
        year: destination.year.or(source.year),
        genre: destination.genre.or(source.genre),
        suffix: destination.suffix.or(source.suffix),
        bit_rate: destination.bit_rate.or(source.bit_rate),
        size_bytes: destination.size_bytes.or(source.size_bytes),
        cover_art_id: canonical_optional_artwork(destination.cover_art_id.or(source.cover_art_id)),
        starred_at: if source_is_newer {
            source.starred_at
        } else {
            destination.starred_at
        },
        user_rating: if source_is_newer {
            source.user_rating
        } else {
            destination.user_rating
        },
        play_count: max_optional(destination.play_count, source.play_count),
        played_at: max_optional(destination.played_at, source.played_at),
        server_path: destination.server_path.or(source.server_path),
        library_id: canonical_optional_id(destination.library_id.or(source.library_id)),
        isrc: destination.isrc.or(source.isrc),
        mbid_recording: destination.mbid_recording.or(source.mbid_recording),
        bpm: destination.bpm.or(source.bpm),
        replay_gain_track_db: destination
            .replay_gain_track_db
            .or(source.replay_gain_track_db),
        replay_gain_album_db: destination
            .replay_gain_album_db
            .or(source.replay_gain_album_db),
        replay_gain_peak: destination.replay_gain_peak.or(source.replay_gain_peak),
        content_hash: destination.content_hash.or(source.content_hash),
        server_updated_at: max_optional(destination.server_updated_at, source.server_updated_at),
        server_created_at: max_optional(destination.server_created_at, source.server_created_at),
        deleted: destination.deleted && source.deleted,
        synced_at: destination.synced_at.max(source.synced_at),
        raw_json: merge_canonical_payloads(
            Some(&destination.raw_json),
            Some(&source.raw_json),
            NavidromePayloadKind::Track,
        )
        .map_err(migration_error)?
        .unwrap_or_default(),
    })
}

fn write_owner(tx: &Transaction<'_>, row: &TrackRow) -> rusqlite::Result<()> {
    tx.prepare_cached(UPSERT_SQL)?.execute(params![
        row.server_id,
        row.id,
        row.title,
        row.title_sort,
        row.artist,
        row.artist_id,
        row.album,
        row.album_id,
        row.album_artist,
        row.duration_sec,
        row.track_number,
        row.disc_number,
        row.year,
        row.genre,
        row.suffix,
        row.bit_rate,
        row.size_bytes,
        row.cover_art_id,
        row.starred_at,
        row.user_rating,
        row.play_count,
        row.played_at,
        row.server_path,
        row.library_id,
        row.isrc,
        row.mbid_recording,
        row.bpm,
        row.replay_gain_track_db,
        row.replay_gain_album_db,
        row.replay_gain_peak,
        row.content_hash,
        row.server_updated_at,
        row.server_created_at,
        if row.deleted { 1_i64 } else { 0_i64 },
        row.synced_at,
        row.raw_json,
        0_i64,
    ])?;
    Ok(())
}

fn clear_deleted_owner_preserved_fields(
    tx: &Transaction<'_>,
    server_id: &str,
    id: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE track SET \
           title_sort = NULL, play_count = NULL, played_at = NULL, library_id = NULL, \
           content_hash = NULL, server_updated_at = NULL, server_created_at = NULL \
         WHERE server_id = ?1 AND id = ?2 AND deleted = 1",
        params![server_id, id],
    )?;
    Ok(())
}

fn verify_retarget(
    tx: &Transaction<'_>,
    server_id: &str,
    old_id: &str,
    new_id: &str,
) -> rusqlite::Result<()> {
    let destination_exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM track WHERE server_id = ?1 AND id = ?2)",
        params![server_id, new_id],
        |row| row.get(0),
    )?;
    let residue: i64 = tx.query_row(
        "SELECT \
           (SELECT COUNT(*) FROM track WHERE server_id = ?1 AND id = ?2) + \
           (SELECT COUNT(*) FROM track_offline WHERE server_id = ?1 AND track_id = ?2) + \
           (SELECT COUNT(*) FROM track_extension WHERE server_id = ?1 AND track_id = ?2) + \
           (SELECT COUNT(*) FROM track_fact WHERE server_id = ?1 AND track_id = ?2) + \
           (SELECT COUNT(*) FROM track_artifact WHERE server_id = ?1 AND track_id = ?2) + \
           (SELECT COUNT(*) FROM track_canonical_link WHERE server_id = ?1 AND track_id = ?2) + \
           (SELECT COUNT(*) FROM canonical_enrichment_link \
              WHERE owner_server_id = ?1 AND owner_track_id = ?2) + \
           (SELECT COUNT(*) FROM play_session WHERE server_id = ?1 AND track_id = ?2) + \
           (SELECT COUNT(*) FROM entity_user_rating \
              WHERE server_id = ?1 AND entity_kind = 'track' AND entity_id = ?2) + \
           (SELECT COUNT(*) FROM track_id_history WHERE server_id = ?1 AND new_id = ?2)",
        params![server_id, old_id],
        |row| row.get(0),
    )?;
    if destination_exists && residue == 0 {
        Ok(())
    } else {
        Err(migration_error(format!(
            "track retarget verification failed `{old_id}` -> `{new_id}`"
        )))
    }
}

fn authority_timestamp(row: &TrackRow) -> i64 {
    row.server_updated_at.unwrap_or(row.synced_at)
}

fn prefer_text(destination: String, source: String) -> String {
    if destination.trim().is_empty() {
        source
    } else {
        destination
    }
}

fn max_optional(left: Option<i64>, right: Option<i64>) -> Option<i64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (left, right) => left.or(right),
    }
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
