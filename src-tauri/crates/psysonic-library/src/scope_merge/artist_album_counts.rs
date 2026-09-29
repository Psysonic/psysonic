use rusqlite::params_from_iter;
use rusqlite::types::Value as SqlValue;

use super::common::scope_cte_sql;
use crate::dto::{LibraryArtistDto, LibraryScopePair};
use crate::identity::norm_part;
use crate::store::LibraryStore;

/// Replace mode-specific browse counts with the full unique album union for the
/// artists on the current page. Candidate-first index probes keep this bounded by
/// the page size instead of rescanning every selected track and credit.
pub(super) fn overlay_artist_album_counts(
    store: &LibraryStore,
    scopes: &[LibraryScopePair],
    artists: &mut [LibraryArtistDto],
) -> Result<(), String> {
    let candidates = artists
        .iter()
        .enumerate()
        .filter_map(|(position, artist)| norm_part(&artist.name).map(|key| (position, key)))
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Ok(());
    }

    let (scope_cte, mut binds) = scope_cte_sql(scopes);
    let candidate_values = candidates
        .iter()
        .map(|(position, _)| format!("({position}, ?)"))
        .collect::<Vec<_>>()
        .join(", ");
    binds.extend(
        candidates
            .iter()
            .map(|(_, key)| SqlValue::Text(key.clone())),
    );
    let sql = format!(
        "{scope_cte}, \
         candidates(position, artist_key) AS (VALUES {candidate_values}), \
         credited_albums(position, album_dedup) AS ( \
           SELECT c.position, COALESCE(NULLIF(abp.identity_key, ''), \
                                      'null:' || t.server_id || ':' || t.album_id) \
           FROM candidates c \
           CROSS JOIN exact_scope s \
           CROSS JOIN artist ar INDEXED BY idx_artist_name_fold \
             ON ar.server_id = s.server_id AND ar.name_fold = c.artist_key \
           CROSS JOIN track t INDEXED BY idx_track_artist \
             ON t.server_id = ar.server_id AND t.artist_id = ar.id \
           LEFT JOIN album_browse_projection abp \
             ON abp.server_id = t.server_id AND abp.library_id = t.library_id \
            AND abp.album_id = t.album_id \
           WHERE t.deleted = 0 AND t.library_id = s.library_id \
             AND t.album_id IS NOT NULL AND t.album_id != '' \
           UNION \
           SELECT c.position, COALESCE(NULLIF(abp.identity_key, ''), \
                                      'null:' || t.server_id || ':' || t.album_id) \
           FROM candidates c \
           CROSS JOIN whole_scope s \
           CROSS JOIN artist ar INDEXED BY idx_artist_name_fold \
             ON ar.server_id = s.server_id AND ar.name_fold = c.artist_key \
           CROSS JOIN track t INDEXED BY idx_track_artist \
             ON t.server_id = ar.server_id AND t.artist_id = ar.id \
           LEFT JOIN album_browse_projection abp \
             ON abp.server_id = t.server_id AND abp.library_id = t.library_id \
            AND abp.album_id = t.album_id \
           WHERE t.deleted = 0 AND t.album_id IS NOT NULL AND t.album_id != '' \
           UNION \
           SELECT c.position, COALESCE(NULLIF(abp.identity_key, ''), \
                                      'null:' || ac.server_id || ':' || ac.album_id) \
           FROM candidates c \
           CROSS JOIN exact_scope s \
           CROSS JOIN artist_credit_projection ac \
             INDEXED BY idx_artist_credit_projection_artist_key \
             ON ac.server_id = s.server_id AND ac.artist_key = c.artist_key \
            AND ac.library_id = s.library_id \
           LEFT JOIN album_browse_projection abp \
             ON abp.server_id = ac.server_id AND abp.library_id = ac.library_id \
            AND abp.album_id = ac.album_id \
           WHERE ac.album_id != '' \
           UNION \
           SELECT c.position, COALESCE(NULLIF(abp.identity_key, ''), \
                                      'null:' || ac.server_id || ':' || ac.album_id) \
           FROM candidates c \
           CROSS JOIN whole_scope s \
           CROSS JOIN artist_credit_projection ac \
             INDEXED BY idx_artist_credit_projection_artist_key \
             ON ac.server_id = s.server_id AND ac.artist_key = c.artist_key \
           LEFT JOIN album_browse_projection abp \
             ON abp.server_id = ac.server_id AND abp.library_id = ac.library_id \
            AND abp.album_id = ac.album_id \
           WHERE ac.album_id != '' \
         ) \
         SELECT position, COUNT(DISTINCT album_dedup) \
         FROM credited_albums GROUP BY position"
    );

    store.with_read_conn(|conn| {
        let mut stmt = conn.prepare(&sql)?;
        let counts = stmt
            .query_map(params_from_iter(binds.iter()), |row| {
                Ok((row.get::<_, i64>(0)? as usize, row.get::<_, i64>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (position, count) in counts {
            if let Some(artist) = artists.get_mut(position) {
                artist.album_count = Some(count);
            }
        }
        Ok(())
    })
}
