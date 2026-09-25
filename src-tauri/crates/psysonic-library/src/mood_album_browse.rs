//! Paginated file mood → album browse from the local `track` index.
//!
//! Uses the same subquery shape as lossless album browse (single SQL round-trip,
//! LIMIT/OFFSET on grouped rows) instead of the heavier Advanced Search builder.

use crate::dto::{
    multi_library_merge_enabled, ordered_library_scope_pairs, LibraryAlbumDto,
    LibraryMoodAlbumsRequest, LibraryMoodAlbumsResponse, LibraryScopePair, LibrarySortClause,
    SortDir,
};
use crate::scope_merge;
use crate::search::library_scope_sargable_equals_sql;
use crate::store::LibraryStore;
use rusqlite::types::Value as SqlValue;
use serde_json::Value;

fn trimmed_nonempty(s: Option<&str>) -> Option<String> {
    s.map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

fn mood_album_order_sql(sort: &[LibrarySortClause]) -> String {
    let la_artist = crate::album_compilation_filter::sql_track_group_display_artist("la");
    let mut keys: Vec<String> = Vec::new();
    for s in sort {
        let col = match s.field.as_str() {
            "name" => "COALESCE(a.name, la.album_name) COLLATE NOCASE".to_string(),
            "artist" => format!("COALESCE(a.artist, {la_artist}) COLLATE NOCASE"),
            "year" => "COALESCE(a.year, la.year)".to_string(),
            _ => continue,
        };
        let dir = match s.dir {
            SortDir::Asc => "ASC",
            SortDir::Desc => "DESC",
        };
        keys.push(format!("{col} {dir}", col = col));
    }
    if keys.is_empty() {
        keys.push("COALESCE(a.name, la.album_name) COLLATE NOCASE ASC".to_string());
    }
    keys.push("la.album_id ASC".to_string());
    format!("ORDER BY {}", keys.join(", "))
}

fn count_mood_albums(
    conn: &rusqlite::Connection,
    where_sql: &str,
    params: &[SqlValue],
    _library_scoped: bool,
) -> Result<u32, rusqlite::Error> {
    let from = "FROM track_mood tm \
     INNER JOIN track t \
       ON t.server_id = tm.server_id AND t.id = tm.track_id AND t.deleted = 0";
    let count_sql = format!("SELECT COUNT(DISTINCT tm.album_id) {from} WHERE {where_sql}");
    let n: i64 = conn.query_row(&count_sql, rusqlite::params_from_iter(params.iter()), |r| {
        r.get(0)
    })?;
    Ok(n.max(0) as u32)
}

fn map_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryAlbumDto> {
    let raw: Option<String> = r.get(12)?;
    Ok(LibraryAlbumDto {
        server_id: r.get(0)?,
        id: r.get(1)?,
        name: r.get(2)?,
        artist: r.get(3)?,
        artist_id: r.get(4)?,
        song_count: r.get(5)?,
        duration_sec: r.get(6)?,
        year: r.get(7)?,
        genre: r.get(8)?,
        cover_art_id: r.get(9)?,
        starred_at: r.get(10)?,
        synced_at: r.get(11)?,
        raw_json: raw
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(Value::Null),
    })
}

/// Paginated albums for one genre. Returns empty when the index has no matching tracks.
pub fn list_albums_by_mood(
    store: &LibraryStore,
    req: &LibraryMoodAlbumsRequest,
) -> Result<LibraryMoodAlbumsResponse, String> {
    if !crate::dto::track_index_nonempty(store, &req.server_id)? {
        return Ok(LibraryMoodAlbumsResponse {
            albums: Vec::new(),
            has_more: false,
            total: None,
            source: "local".to_string(),
        });
    }

    let mood = req.mood.trim();
    if mood.is_empty() {
        return Ok(LibraryMoodAlbumsResponse {
            albums: Vec::new(),
            has_more: false,
            total: None,
            source: "local".to_string(),
        });
    }

    let limit = if req.count_only { 0 } else { req.limit.max(1) };
    let offset = req.offset;

    let scope_pairs = ordered_library_scope_pairs(
        &req.server_id,
        req.library_scope.as_deref(),
        req.library_scopes.as_deref(),
    )?;
    // Any >1-library scope collapses duplicates via cluster keys — including the
    // Layer-1 same-server path, whose genre `EXISTS` sets `merge_by_album_key`.
    // Build keys first so dedup works on a cold index (not only after a prior
    // search / sync-idle rebuild happened to populate them).
    if multi_library_merge_enabled(&scope_pairs) {
        crate::scope_merge::ensure_cluster_keys_for_scopes(store, &scope_pairs)?;
    }
    if !scope_pairs.is_empty() {
        return list_albums_by_mood_scoped(store, req, &scope_pairs, mood, limit, offset);
    }

    let mut legacy = req.clone();
    if legacy.library_scope.is_none() {
        if let Some(pair) = scope_pairs.first() {
            legacy.library_scope = pair.library_id.clone();
        }
    }

    let order_sql = mood_album_order_sql(&legacy.sort);

    let mut where_clauses = vec![
        "tm.server_id = ?1".to_string(),
        "tm.album_id IS NOT NULL AND tm.album_id != ''".to_string(),
        "tm.mood = ?2 COLLATE NOCASE".to_string(),
    ];
    let mut params: Vec<SqlValue> = vec![
        SqlValue::Text(legacy.server_id.clone()),
        SqlValue::Text(mood.to_string()),
    ];

    let library_scoped = trimmed_nonempty(legacy.library_scope.as_deref()).is_some();
    if let Some(scope) = trimmed_nonempty(legacy.library_scope.as_deref()) {
        where_clauses.push(library_scope_sargable_equals_sql("t"));
        params.push(SqlValue::Text(scope));
    }

    let where_sql = where_clauses.join(" AND ");
    let la_artist = crate::album_compilation_filter::sql_track_group_display_artist("la");
    let sql = format!(
        "SELECT \
           la.server_id, \
           la.album_id, \
           COALESCE(a.name, la.album_name), \
           COALESCE(a.artist, {la_artist}), \
           COALESCE(a.artist_id, la.artist_id), \
           COALESCE(a.song_count, la.track_count), \
           COALESCE(a.duration_sec, la.duration_sec), \
           COALESCE(a.year, la.year), \
           COALESCE(a.genre, la.genre), \
           COALESCE(a.cover_art_id, la.cover_art_id), \
           COALESCE(a.starred_at, la.starred_at), \
           COALESCE(a.synced_at, la.synced_at), \
           a.raw_json \
         FROM ( \
           SELECT \
             tm.server_id, \
             tm.album_id, \
             MAX(t.album) AS album_name, \
             MAX(t.artist) AS artist, \
             MAX(t.album_artist) AS album_artist, \
             MAX(t.artist_id) AS artist_id, \
             MAX(t.year) AS year, \
             MAX(t.genre) AS genre, \
             MAX(t.cover_art_id) AS cover_art_id, \
             MAX(t.starred_at) AS starred_at, \
             MAX(t.synced_at) AS synced_at, \
             COUNT(*) AS track_count, \
             COALESCE(SUM(t.duration_sec), 0) AS duration_sec \
           FROM track_mood tm \
           INNER JOIN track t \
             ON t.server_id = tm.server_id AND t.id = tm.track_id AND t.deleted = 0 \
           WHERE {where_sql} \
           GROUP BY tm.server_id, tm.album_id \
         ) la \
         LEFT JOIN album a ON a.server_id = la.server_id AND a.id = la.album_id \
         {order_sql} \
         LIMIT ? OFFSET ?"
    );

    let count_params = params.clone();
    params.push(SqlValue::Integer(limit as i64));
    params.push(SqlValue::Integer(offset as i64));

    store.with_read_conn(|conn| {
        let total = if legacy.include_total {
            Some(count_mood_albums(
                conn,
                &where_sql,
                &count_params,
                library_scoped,
            )?)
        } else {
            None
        };
        if legacy.count_only {
            return Ok(LibraryMoodAlbumsResponse {
                albums: Vec::new(),
                has_more: false,
                total,
                source: "local".to_string(),
            });
        }

        let mut stmt = conn.prepare(&sql)?;
        let mut albums = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), map_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        crate::browse_support::overlay_album_artist_links(conn, &mut albums);
        let has_more = albums.len() as u32 == limit;
        Ok(LibraryMoodAlbumsResponse {
            albums,
            has_more,
            total,
            source: "local".to_string(),
        })
    })
}

fn mood_multi_scope_order_sql(sort: &[LibrarySortClause]) -> String {
    let mut keys: Vec<String> = Vec::new();
    for s in sort {
        let col = match s.field.as_str() {
            "name" => "name COLLATE NOCASE".to_string(),
            "artist" => "artist COLLATE NOCASE".to_string(),
            "year" => "year".to_string(),
            _ => continue,
        };
        let dir = match s.dir {
            SortDir::Asc => "ASC",
            SortDir::Desc => "DESC",
        };
        keys.push(format!("{col} {dir}"));
    }
    if keys.is_empty() {
        keys.push("name COLLATE NOCASE ASC".to_string());
    }
    keys.push("album_id ASC".to_string());
    format!("ORDER BY {}", keys.join(", "))
}

fn scoped_mood_album_cte(scopes: &[LibraryScopePair], mood: &str) -> (String, Vec<SqlValue>) {
    let (scope_cte, mut binds) = scope_merge::scope_cte_sql(scopes);
    binds.push(SqlValue::Text(mood.to_string()));
    let cte = format!(
        "{scope_cte}, \
         mood_filter(value) AS (VALUES (?)), \
         mood_album_candidates AS MATERIALIZED ( \
           SELECT tm.server_id, t.library_id, tm.album_id, s.pr \
           FROM exact_scope s \
           CROSS JOIN mood_filter mf \
           INNER JOIN track_mood tm INDEXED BY idx_track_mood_browse \
             ON tm.server_id = s.server_id AND tm.mood = mf.value COLLATE NOCASE \
           INNER JOIN track t INDEXED BY sqlite_autoindex_track_1 \
             ON t.server_id = tm.server_id AND t.id = tm.track_id \
            AND t.album_id = tm.album_id AND t.library_id = s.library_id \
           WHERE t.deleted = 0 AND tm.album_id IS NOT NULL AND tm.album_id != '' \
           GROUP BY tm.server_id, t.library_id, tm.album_id, s.pr \
           UNION ALL \
           SELECT tm.server_id, t.library_id, tm.album_id, s.pr \
           FROM whole_scope s \
           CROSS JOIN mood_filter mf \
           INNER JOIN track_mood tm INDEXED BY idx_track_mood_browse \
             ON tm.server_id = s.server_id AND tm.mood = mf.value COLLATE NOCASE \
           INNER JOIN track t INDEXED BY sqlite_autoindex_track_1 \
             ON t.server_id = tm.server_id AND t.id = tm.track_id \
            AND t.album_id = tm.album_id \
           WHERE t.deleted = 0 AND tm.album_id IS NOT NULL AND tm.album_id != '' \
           GROUP BY tm.server_id, t.library_id, tm.album_id, s.pr \
         ), \
         physical AS MATERIALIZED ( \
           SELECT p.*, c.pr, \
                  COALESCE(NULLIF(p.identity_key, ''), \
                           p.server_id || X'1F' || p.library_id || X'1F' || p.album_id) AS album_dedup \
           FROM mood_album_candidates c \
           INNER JOIN album_browse_projection p \
             ON p.server_id = c.server_id \
            AND p.library_id = c.library_id \
            AND p.album_id = c.album_id \
         ), \
         ranked AS MATERIALIZED ( \
           SELECT physical.*, ROW_NUMBER() OVER ( \
             PARTITION BY album_dedup ORDER BY pr, server_id, library_id, album_id \
           ) AS album_rank \
           FROM physical \
         )"
    );
    (cte, binds)
}

fn map_scoped_mood_album_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<scope_merge::AlbumListRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        None,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
        row.get(11)?,
    ))
}

fn list_albums_by_mood_scoped(
    store: &LibraryStore,
    req: &LibraryMoodAlbumsRequest,
    scopes: &[LibraryScopePair],
    genre: &str,
    limit: u32,
    offset: u32,
) -> Result<LibraryMoodAlbumsResponse, String> {
    let (cte, binds) = scoped_mood_album_cte(scopes, genre);
    let order = mood_multi_scope_order_sql(&req.sort);
    let total = if req.include_total {
        let count_sql = format!("{cte} SELECT COUNT(*) FROM ranked WHERE album_rank = 1");
        Some(store.with_read_conn(|conn| {
            let count: i64 = conn.query_row(
                &count_sql,
                rusqlite::params_from_iter(binds.iter()),
                |row| row.get(0),
            )?;
            Ok(count.max(0) as u32)
        })?)
    } else {
        None
    };
    if limit == 0 {
        return Ok(LibraryMoodAlbumsResponse {
            albums: Vec::new(),
            has_more: false,
            total,
            source: "local".to_string(),
        });
    }

    let sql = format!(
        "{cte} \
         SELECT server_id, album_id, name, artist, artist_id, song_count, duration_sec, \
                year, genre, cover_art_id, starred_at, synced_at \
         FROM ranked WHERE album_rank = 1 \
         {order} LIMIT ? OFFSET ?"
    );
    let mut page_binds = binds;
    page_binds.push(SqlValue::Integer(i64::from(limit)));
    page_binds.push(SqlValue::Integer(i64::from(offset)));
    let albums = store.with_read_conn(|conn| {
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(
                rusqlite::params_from_iter(page_binds.iter()),
                map_scoped_mood_album_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows
            .into_iter()
            .map(scope_merge::album_row_to_dto)
            .collect::<Vec<_>>())
    })?;
    let has_more = albums.len() as u32 == limit;
    let (albums, _) = scope_merge::finish_scope_album_list(store, albums, total.unwrap_or(0))?;
    Ok(LibraryMoodAlbumsResponse {
        albums,
        has_more,
        total,
        source: "local".to_string(),
    })
}

#[cfg(test)]
#[path = "mood_album_browse/tests.rs"]
mod tests;
