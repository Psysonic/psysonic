use std::collections::BTreeMap;

use rusqlite::types::Value as SqlValue;

use crate::dto::{
    LibraryStatisticsDto, LibraryStatisticsFormatDto, LibraryStatisticsGenreDto,
    LibraryStatisticsRequest, LibraryStatisticsScope,
};
use crate::store::LibraryStore;

fn scope_where(scope: &LibraryStatisticsScope, alias: &str) -> (String, Vec<SqlValue>) {
    let mut clauses = vec![format!("{alias}.server_id = ?")];
    let mut params = vec![SqlValue::Text(scope.server_id.clone())];
    let library_ids: Vec<&str> = scope
        .library_ids
        .iter()
        .map(String::as_str)
        .filter(|id| !id.is_empty())
        .collect();
    if !library_ids.is_empty() {
        clauses.push(format!(
            "{alias}.library_id IN ({})",
            std::iter::repeat_n("?", library_ids.len())
                .collect::<Vec<_>>()
                .join(", ")
        ));
        params.extend(
            library_ids
                .into_iter()
                .map(|id| SqlValue::Text(id.to_string())),
        );
    }
    (clauses.join(" AND "), params)
}

/// Aggregate the selected index rows without merging equivalent entities across
/// servers or music folders. This keeps multi-server Statistics bounded to SQL
/// aggregate reads instead of walking each server's REST album catalogue.
pub fn query_statistics(
    store: &LibraryStore,
    request: &LibraryStatisticsRequest,
) -> Result<LibraryStatisticsDto, String> {
    store.with_scope_detail_read_conn(|conn| {
        let mut artist_count = 0_i64;
        let mut album_count = 0_i64;
        let mut song_count = 0_i64;
        let mut playtime_sec = 0_i64;
        let mut genres = BTreeMap::<String, (i64, i64)>::new();
        let mut formats = BTreeMap::<String, i64>::new();

        for scope in &request.scopes {
            if scope.server_id.trim().is_empty() {
                continue;
            }

            let (track_where, track_params) = scope_where(scope, "t");
            let track_where = format!("{track_where} AND t.deleted = 0");
            let (tracks, duration): (i64, i64) = conn.query_row(
                &format!(
                    "SELECT COUNT(*), COALESCE(SUM(t.duration_sec), 0) FROM track t WHERE {track_where}"
                ),
                rusqlite::params_from_iter(track_params.iter()),
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            song_count += tracks;
            playtime_sec += duration;

            let format_sql = format!(
                "SELECT COALESCE(NULLIF(UPPER(TRIM(t.suffix)), ''), 'Unknown'), COUNT(*) \
                 FROM track t WHERE {track_where} \
                 GROUP BY COALESCE(NULLIF(UPPER(TRIM(t.suffix)), ''), 'Unknown')"
            );
            let mut format_stmt = conn.prepare(&format_sql)?;
            let format_rows = format_stmt.query_map(
                rusqlite::params_from_iter(track_params.iter()),
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )?;
            for format in format_rows {
                let (value, songs) = format?;
                *formats.entry(value).or_default() += songs;
            }

            let (projection_where, projection_params) = scope_where(scope, "p");
            album_count += conn.query_row(
                &format!("SELECT COUNT(*) FROM album_browse_projection p WHERE {projection_where}"),
                rusqlite::params_from_iter(projection_params.iter()),
                |row| row.get::<_, i64>(0),
            )?;

            // Keep duplicate artists from separately selected folders/servers.
            // The DISTINCT is only within one folder, where it defines an artist count.
            let artist_sql = format!(
                "SELECT COUNT(DISTINCT COALESCE(NULLIF(t.artist_id, ''), NULLIF(t.artist, ''))) \
                 FROM track t WHERE {track_where} GROUP BY COALESCE(t.library_id, '')"
            );
            let mut artist_stmt = conn.prepare(&artist_sql)?;
            let artist_rows = artist_stmt.query_map(
                rusqlite::params_from_iter(track_params.iter()),
                |row| row.get::<_, i64>(0),
            )?;
            for count in artist_rows {
                artist_count += count?;
            }

            // `track_genre` keeps every indexed tag instead of the projection's
            // representative album genre, so multi-tag albums are not discarded.
            let genre_sql = format!(
                "SELECT COALESCE(NULLIF(TRIM(g.genre), ''), ''), COUNT(*), \
                        COUNT(DISTINCT COALESCE(NULLIF(g.album_id, ''), g.track_id)) \
                 FROM track_genre g \
                 INNER JOIN track t ON t.server_id = g.server_id AND t.id = g.track_id \
                 WHERE {track_where} \
                 GROUP BY COALESCE(NULLIF(TRIM(g.genre), ''), '')"
            );
            let mut genre_stmt = conn.prepare(&genre_sql)?;
            let genre_rows = genre_stmt.query_map(
                rusqlite::params_from_iter(track_params.iter()),
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
            )?;
            for genre in genre_rows {
                let (value, songs, albums) = genre?;
                let entry = genres.entry(value).or_default();
                entry.0 += songs;
                entry.1 += albums;
            }
        }

        let mut genres: Vec<LibraryStatisticsGenreDto> = genres
            .into_iter()
            .map(|(value, (song_count, album_count))| LibraryStatisticsGenreDto {
                value,
                song_count,
                album_count,
            })
            .collect();
        genres.sort_by(|a, b| b.song_count.cmp(&a.song_count).then_with(|| a.value.cmp(&b.value)));
        let mut formats: Vec<LibraryStatisticsFormatDto> = formats
            .into_iter()
            .map(|(value, song_count)| LibraryStatisticsFormatDto { value, song_count })
            .collect();
        formats.sort_by(|a, b| b.song_count.cmp(&a.song_count).then_with(|| a.value.cmp(&b.value)));

        Ok(LibraryStatisticsDto {
            artist_count,
            album_count,
            song_count,
            playtime_sec,
            genres,
            formats,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_selected_servers_without_cross_server_deduplication() {
        let store = LibraryStore::open_in_memory();
        store.with_conn("statistics.test", |conn| {
            for (server, library, album, track, artist, duration, suffix, genre) in [
                ("s1", "one", "a1", "t1", "shared", 120, "flac", "Rock"),
                ("s1", "two", "a2", "t2", "shared", 180, "mp3", "Jazz"),
                ("s2", "one", "a1", "t3", "shared", 240, "flac", "Rock"),
            ] {
                conn.execute(
                    "INSERT INTO track (server_id, id, title, artist, album, album_id, library_id, duration_sec, suffix, synced_at, raw_json) \
                     VALUES (?1, ?2, ?2, ?3, ?4, ?4, ?5, ?6, ?7, 1, '{}')",
                    rusqlite::params![server, track, artist, album, library, duration, suffix],
                )?;
                conn.execute(
                    "INSERT INTO track_genre (server_id, track_id, genre, album_id, library_id) \
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![server, track, genre, album, library],
                )?;
                conn.execute(
                    "INSERT INTO album_browse_projection \
                     (server_id, library_id, album_id, name, song_count, duration_sec, genre, synced_at, representative_track_id) \
                     VALUES (?1, ?2, ?3, ?3, 1, ?4, ?5, 1, ?6)",
                    rusqlite::params![server, library, album, duration, genre, track],
                )?;
            }
            Ok(())
        }).unwrap();

        let result = query_statistics(
            &store,
            &LibraryStatisticsRequest {
                scopes: vec![
                    LibraryStatisticsScope {
                        server_id: "s1".into(),
                        library_ids: vec!["one".into(), "two".into()],
                    },
                    LibraryStatisticsScope {
                        server_id: "s2".into(),
                        library_ids: vec![],
                    },
                ],
            },
        )
        .unwrap();

        assert_eq!(result.song_count, 3);
        assert_eq!(result.album_count, 3);
        assert_eq!(result.playtime_sec, 540);
        assert_eq!(
            result.artist_count, 3,
            "each selected folder/server keeps its own artist row"
        );
        assert_eq!(result.genres[0].value, "Rock");
        assert_eq!(result.genres[0].song_count, 2);
        assert_eq!(result.formats[0].value, "FLAC");
        assert_eq!(result.formats[0].song_count, 2);
    }
}
