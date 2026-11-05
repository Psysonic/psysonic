//! Original and edition release year per physical album.
//!
//! Album rows only carry one `year`, and what it holds depends on how the files
//! were tagged: Navidrome fills it from the `date` tag, which is the original
//! year on some libraries and the reissue's year on others. The two years the
//! user can choose between therefore come from fields that say which one they
//! are, read back per `(server_id, album_id)` when album rows are built:
//!
//! - tracks from Navidrome's native API carry `originalYear` / `releaseYear`;
//! - every other track only has `year`, so the album census stores what
//!   `getAlbumList2` reports as `originalReleaseDate` / `releaseDate` in
//!   `album_release_year`.
//!
//! The track fields win: the delta keeps them current, while the table is only
//! as fresh as the last complete census. Both land in the album's `raw_json`
//! as `originalYear` / `releaseYear`, next to `year`, which stays as it is.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{Map, Value};

use crate::dto::LibraryAlbumDto;

/// `originalYear` of track `t` from Navidrome's native API, NULL elsewhere.
/// The `instr` test keeps tracks without the field from paying a JSON parse.
pub(crate) const TRACK_NATIVE_ORIGINAL_YEAR_SQL: &str =
    "CASE WHEN instr(t.raw_json, '\"originalYear\"') > 0 AND json_valid(t.raw_json) \
          THEN NULLIF(CAST(json_extract(t.raw_json, '$.originalYear') AS INTEGER), 0) END";

/// `releaseYear` of track `t` from Navidrome's native API, NULL elsewhere.
/// Unlike `identity::TRACK_RELEASE_YEAR_SQL` this does not fall back to `year`:
/// a plain `year` says nothing about which of the two years it is.
pub(crate) const TRACK_NATIVE_RELEASE_YEAR_SQL: &str =
    "CASE WHEN instr(t.raw_json, '\"releaseYear\"') > 0 AND json_valid(t.raw_json) \
          THEN NULLIF(CAST(json_extract(t.raw_json, '$.releaseYear') AS INTEGER), 0) END";

/// One album's years as a server reports them on `getAlbumList2`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlbumReleaseYears {
    pub album_id: String,
    pub original_year: Option<i64>,
    pub release_year: Option<i64>,
}

/// The years an album row ends up with, before they are written into it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ResolvedReleaseYears {
    pub original_year: Option<i64>,
    pub release_year: Option<i64>,
}

impl ResolvedReleaseYears {
    /// Track fields first, census table second, each year on its own.
    pub(crate) fn resolve(
        native_original: Option<i64>,
        native_release: Option<i64>,
        stored_original: Option<i64>,
        stored_release: Option<i64>,
    ) -> Self {
        let positive = |year: Option<i64>| year.filter(|year| *year > 0);
        Self {
            original_year: positive(native_original).or(positive(stored_original)),
            release_year: positive(native_release).or(positive(stored_release)),
        }
    }
}

/// Store what one complete census page run reported and return how many rows
/// changed. Writes only rows whose years moved, so a run over an unchanged
/// catalogue writes nothing. An album the server no longer dates loses its row
/// rather than keeping a year the server has withdrawn.
pub(crate) fn store_album_release_years(
    conn: &Connection,
    server_id: &str,
    albums: &[AlbumReleaseYears],
) -> rusqlite::Result<usize> {
    let mut upsert = conn.prepare_cached(
        "INSERT INTO album_release_year (server_id, album_id, original_year, release_year) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(server_id, album_id) DO UPDATE SET \
           original_year = excluded.original_year, \
           release_year = excluded.release_year \
         WHERE original_year IS NOT excluded.original_year \
            OR release_year IS NOT excluded.release_year",
    )?;
    let mut remove = conn
        .prepare_cached("DELETE FROM album_release_year WHERE server_id = ?1 AND album_id = ?2")?;
    let mut changed = 0;
    for album in albums {
        let original = album.original_year.filter(|year| *year > 0);
        let release = album.release_year.filter(|year| *year > 0);
        changed += if original.is_none() && release.is_none() {
            remove.execute(params![server_id, album.album_id])?
        } else {
            upsert.execute(params![server_id, album.album_id, original, release])?
        };
    }
    Ok(changed)
}

/// The census table's years for one physical album.
pub(crate) fn stored_album_release_years(
    conn: &Connection,
    server_id: &str,
    album_id: &str,
) -> rusqlite::Result<Option<(Option<i64>, Option<i64>)>> {
    conn.prepare_cached(
        "SELECT original_year, release_year FROM album_release_year \
         WHERE server_id = ?1 AND album_id = ?2",
    )?
    .query_row(params![server_id, album_id], |r| Ok((r.get(0)?, r.get(1)?)))
    .optional()
}

/// Resolve and write the years of rows that do not go through
/// `browse_support::overlay_album_artist_links`, which reads them in its own
/// per-album scan. Costs one indexed range scan per row.
pub(crate) fn overlay_album_release_years(conn: &Connection, albums: &mut [LibraryAlbumDto]) {
    if albums.is_empty() {
        return;
    }
    let sql = format!(
        "SELECT MAX({original}), MAX({release}) FROM track t \
         WHERE t.server_id = ?1 AND t.album_id = ?2 AND t.deleted = 0",
        original = TRACK_NATIVE_ORIGINAL_YEAR_SQL,
        release = TRACK_NATIVE_RELEASE_YEAR_SQL,
    );
    let Ok(mut stmt) = conn.prepare_cached(&sql) else {
        return;
    };
    for album in albums.iter_mut() {
        let (native_original, native_release) = stmt
            .query_row(params![album.server_id, album.id], |r| {
                Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?))
            })
            .unwrap_or((None, None));
        let (stored_original, stored_release) =
            stored_album_release_years(conn, &album.server_id, &album.id)
                .unwrap_or(None)
                .unwrap_or((None, None));
        set_album_release_years(
            album,
            ResolvedReleaseYears::resolve(
                native_original,
                native_release,
                stored_original,
                stored_release,
            ),
        );
    }
}

/// Write `originalYear` / `releaseYear` into the row's `raw_json`. A row that
/// carries a payload which is not an object keeps it untouched, the same rule
/// `createdMs` follows.
pub(crate) fn set_album_release_years(album: &mut LibraryAlbumDto, years: ResolvedReleaseYears) {
    let fields = [
        ("originalYear", years.original_year),
        ("releaseYear", years.release_year),
    ];
    if fields.iter().all(|(_, year)| year.is_none()) {
        return;
    }
    if album.raw_json.is_null() {
        album.raw_json = Value::Object(Map::new());
    }
    let Some(map) = album.raw_json.as_object_mut() else {
        return;
    };
    for (key, year) in fields {
        if let Some(year) = year {
            map.insert(key.to_string(), Value::from(year));
        }
    }
}

#[cfg(test)]
mod tests;
