//! Same-library release separation.
//!
//! The album key (artist + album + version) cannot tell an original from its
//! reissue. Within one `(server_id, library_id)` the server already decided:
//! two physical albums there are two releases, because it minted two ids.
//! When such a pair shares a base key and carries different years, the year
//! becomes part of the key — as `<base>␟@<year>` — for every physical album
//! with that base key, on every server, so a copy elsewhere still merges with
//! its twin of the same year. Without such a conflict the key stays the base,
//! which keeps cross-library and cross-server copies with diverging year tags
//! merged, and keeps one release that the server split into two ids (same
//! year) on one page.
//!
//! `norm_part` output is alphanumeric, so `␟@` can only start the year suffix.
//!
//! The affected bases travel as a JSON array parameter rather than through a
//! temp table, so a maintenance pass that changes nothing writes nothing.

use std::collections::BTreeSet;

use rusqlite::{params, params_from_iter, Transaction};

/// `<base>` of a stored album key, without a year suffix.
const BASE_KEY_EXPR: &str = "CASE WHEN instr(ck.album_key, char(31) || '@') > 0 \
     THEN substr(ck.album_key, 1, instr(ck.album_key, char(31) || '@') - 1) \
     ELSE ck.album_key END";

/// Every live track whose stored album key belongs to one of the bases in the
/// JSON array `?1`: the base itself or `<base>␟@<year>`. Walks the servers in
/// the sidecar (prefix seek over the primary key) and range-scans
/// `idx_ck_server_album` per base.
pub(crate) const RELEASE_MEMBER_CTE_SQL: &str = "\
    release_server(server_id) AS ( \
      SELECT MIN(server_id) FROM cluster.track_cluster_key \
      UNION ALL \
      SELECT (SELECT MIN(server_id) FROM cluster.track_cluster_key \
              WHERE server_id > release_server.server_id) \
      FROM release_server WHERE release_server.server_id IS NOT NULL \
    ), \
    release_base(base_key) AS MATERIALIZED ( \
      SELECT DISTINCT value FROM json_each(?1) WHERE type = 'text' \
    ), \
    release_member AS MATERIALIZED ( \
      SELECT ck.server_id, ck.track_id, base.base_key, \
             COALESCE(t.library_id, '') AS library_id, t.album_id, \
             NULLIF(t.year, 0) AS year \
      FROM release_base base \
      CROSS JOIN release_server srv \
      CROSS JOIN cluster.track_cluster_key ck INDEXED BY idx_ck_server_album \
        ON ck.server_id = srv.server_id \
       AND ck.album_key >= base.base_key \
       AND ck.album_key < base.base_key || char(31) || 'A' \
      INNER JOIN track t INDEXED BY sqlite_autoindex_track_1 \
        ON t.server_id = ck.server_id AND t.id = ck.track_id \
      WHERE srv.server_id IS NOT NULL \
        AND (ck.album_key = base.base_key \
             OR substr(ck.album_key, length(base.base_key) + 1, 2) = char(31) || '@') \
        AND t.deleted = 0 AND t.album_id IS NOT NULL AND t.album_id != '' \
    )";

/// Affected base keys of one maintenance pass.
#[derive(Default)]
pub(super) struct AffectedBases(BTreeSet<String>);

impl AffectedBases {
    fn extend(
        &mut self,
        tx: &Transaction<'_>,
        sql: &str,
        server_id: Option<&str>,
    ) -> rusqlite::Result<()> {
        let mut statement = tx.prepare(sql)?;
        let rows =
            statement.query_map(params_from_iter(server_id), |row| row.get::<_, String>(0))?;
        for base in rows {
            self.0.insert(base?);
        }
        Ok(())
    }

    /// Bases of every stored key on one server, or on all servers.
    pub(super) fn capture_rebuild(
        &mut self,
        tx: &Transaction<'_>,
        server_id: Option<&str>,
    ) -> rusqlite::Result<()> {
        let server_filter = if server_id.is_some() {
            " AND ck.server_id = ?1"
        } else {
            ""
        };
        self.extend(
            tx,
            &format!(
                "SELECT DISTINCT {BASE_KEY_EXPR} FROM cluster.track_cluster_key ck \
                 WHERE ck.album_key IS NOT NULL AND ck.album_key NOT LIKE 'physical:%'{server_filter}"
            ),
            server_id,
        )
    }

    /// Bases of the stored keys the invalidation journal touches. Deleted
    /// tracks count too — a removed reissue has to release its original from
    /// the split — and they reach this through their journalled track ids:
    /// every tombstone path records the ids it deletes, so the album expansion
    /// can stay on the partial live-track index.
    pub(super) fn capture_invalidated(
        &mut self,
        tx: &Transaction<'_>,
        server_id: &str,
    ) -> rusqlite::Result<()> {
        self.extend(
            tx,
            &format!(
                "WITH invalidated_artist AS MATERIALIZED ( \
                   SELECT entity_id FROM identity_invalidation \
                   WHERE server_id = ?1 AND kind = 'artist' \
                 ), \
                 invalidated_album AS MATERIALIZED ( \
                   SELECT entity_id FROM identity_invalidation \
                   WHERE server_id = ?1 AND kind = 'album' \
                   UNION \
                   SELECT DISTINCT t.album_id FROM invalidated_artist ia \
                   CROSS JOIN track t INDEXED BY idx_track_artist \
                   WHERE t.server_id = ?1 AND t.artist_id = ia.entity_id AND t.deleted = 0 \
                     AND t.album_id IS NOT NULL AND t.album_id != '' \
                 ), \
                 touched_track AS MATERIALIZED ( \
                   SELECT entity_id AS track_id FROM identity_invalidation \
                   WHERE server_id = ?1 AND kind = 'track' \
                   UNION \
                   SELECT t.id FROM invalidated_album ia \
                   CROSS JOIN track t INDEXED BY idx_track_album \
                   WHERE t.server_id = ?1 AND t.album_id = ia.entity_id AND t.deleted = 0 \
                 ) \
                 SELECT DISTINCT {BASE_KEY_EXPR} FROM touched_track touched \
                 INNER JOIN cluster.track_cluster_key ck \
                   ON ck.server_id = ?1 AND ck.track_id = touched.track_id \
                 WHERE ck.album_key IS NOT NULL AND ck.album_key NOT LIKE 'physical:%'"
            ),
            Some(server_id),
        )
    }

    /// The bases as the JSON array `RELEASE_MEMBER_CTE_SQL` reads, or `None`
    /// when nothing was touched.
    pub(super) fn to_json(&self) -> Option<String> {
        (!self.0.is_empty())
            .then(|| serde_json::to_string(&self.0).unwrap_or_else(|_| "[]".to_string()))
    }
}

/// Re-derive the final key of every track under the bases in `bases_json`.
pub(super) fn separate_same_library_releases(
    tx: &Transaction<'_>,
    bases_json: &str,
) -> rusqlite::Result<usize> {
    tx.execute(
        &format!(
            "WITH RECURSIVE {RELEASE_MEMBER_CTE_SQL}, \
             album_year AS MATERIALIZED ( \
               SELECT server_id, album_id, base_key, MAX(year) AS year \
               FROM release_member GROUP BY server_id, album_id, base_key \
             ), \
             scope_album AS MATERIALIZED ( \
               SELECT DISTINCT server_id, library_id, album_id, base_key FROM release_member \
             ), \
             split_base AS MATERIALIZED ( \
               SELECT DISTINCT scope_album.base_key \
               FROM scope_album \
               INNER JOIN album_year USING (server_id, album_id, base_key) \
               GROUP BY scope_album.server_id, scope_album.library_id, scope_album.base_key \
               HAVING COUNT(DISTINCT scope_album.album_id) >= 2 \
                  AND COUNT(DISTINCT album_year.year) >= 2 \
             ), \
             target AS ( \
               SELECT member.server_id, member.track_id, \
                      CASE WHEN split_base.base_key IS NOT NULL AND album_year.year IS NOT NULL \
                           THEN member.base_key || char(31) || '@' || album_year.year \
                           ELSE member.base_key END AS album_key \
               FROM release_member member \
               INNER JOIN album_year \
                 ON album_year.server_id = member.server_id \
                AND album_year.album_id = member.album_id \
                AND album_year.base_key = member.base_key \
               LEFT JOIN split_base ON split_base.base_key = member.base_key \
             ) \
             UPDATE cluster.track_cluster_key AS ck \
             SET album_key = target.album_key \
             FROM target \
             WHERE ck.server_id = target.server_id AND ck.track_id = target.track_id \
               AND ck.album_key IS NOT target.album_key"
        ),
        params![bases_json],
    )
}
