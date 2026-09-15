//! Remove `artist` browse rows orphaned by server-side renames/removals.
//!
//! `getArtists` derives artist ids from tags, so renaming an artist mints a
//! *new* id server-side and drops the old one. Track ingest moves the affected
//! tracks onto the new id (or the resync orphan sweep / tombstone reconciler
//! soft-deletes them), but the stale **`artist`** browse row was never pruned —
//! it lingered in the catalog and opened to "Artist not found" because detail
//! resolves from live tracks.
//!
//! **Authority.** A row is removed only when *both* signals agree:
//! - it is **not confirmed by the latest `getArtists` pass** — its `synced_at`
//!   is older than the freshest `artist` row for the same server (every artist
//!   the pass returned was re-stamped `now`), and
//! - **no live (`deleted = 0`) track credits it** (any album/track credit).
//!
//! Callers must only invoke the prune after a *confirmed* `getArtists` pass
//! (`upsert_index` wrote ≥ 1 row): otherwise `backfill_from_tracks` can advance
//! the freshest `synced_at` from a track alone, and an empty/partial `getArtists`
//! would mass-prune album-artist-only rows. The sync call sites gate on that
//! count; the one-time open reconcile only runs on the last authoritative
//! snapshot already in the DB.
//!
//! **Album rows are intentionally not pruned here.** They have no `getArtists`
//! equivalent to supply a freshness stamp (N1 ingest never stamps `album`, and
//! several on-demand paths insert track-less rows), so a "no live track" delete
//! is unsafe. Album-ghost cleanup needs its own positive-confirmation signal —
//! tracked as a follow-up.
//!
//! **Scope.** Track matching is server-wide, which is correct for the default
//! all-libraries sync. A session bound to a single `library_scope` is a
//! pre-existing sweep hazard (it soft-deletes other libraries' tracks); this
//! prune inherits that assumption and should only run for all-libraries syncs.

use rusqlite::{params, Connection, Result as SqlResult};

use crate::store::LibraryStore;

/// Prune orphaned `artist` rows for one server (sync paths). Computes the
/// freshest `synced_at` once (index-backed) and deletes rows below it with no
/// live track. Caller must confirm `getArtists` returned ≥ 1 artist first.
pub fn prune_orphan_artists_for_server(
    store: &LibraryStore,
    server_id: &str,
) -> Result<u32, String> {
    store.with_conn_mut("orphan_cleanup.prune_artists", |conn| {
        let cutoff: Option<i64> = conn.query_row(
            "SELECT MAX(synced_at) FROM artist WHERE server_id = ?1",
            params![server_id],
            |r| r.get(0),
        )?;
        let Some(cutoff) = cutoff else { return Ok(0) };
        let removed = conn.execute(
            "DELETE FROM artist \
             WHERE server_id = ?1 AND synced_at < ?2 \
               AND NOT EXISTS ( \
                 SELECT 1 FROM track \
                 WHERE track.server_id = artist.server_id \
                   AND track.artist_id = artist.id \
                   AND track.deleted = 0 \
               )",
            params![server_id, cutoff],
        )?;
        Ok(removed as u32)
    })
}

/// Prune orphaned `artist` rows across **every** server (one-time open
/// reconcile). Per-server freshest `synced_at` via a correlated subquery — runs
/// once at open, not on the hot sync path.
pub fn prune_orphan_artists_all(conn: &Connection) -> SqlResult<usize> {
    conn.execute(
        "DELETE FROM artist \
         WHERE synced_at < ( \
             SELECT MAX(ai.synced_at) FROM artist ai WHERE ai.server_id = artist.server_id \
         ) \
         AND NOT EXISTS ( \
             SELECT 1 FROM track \
             WHERE track.server_id = artist.server_id \
               AND track.artist_id = artist.id \
               AND track.deleted = 0 \
         )",
        [],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_artist(store: &LibraryStore, server: &str, id: &str, synced_at: i64) {
        store
            .with_conn_mut("test.seed_artist", |c| {
                c.execute(
                    "INSERT INTO artist (server_id, id, name, name_sort, synced_at) \
                     VALUES (?1, ?2, ?2, ?2, ?3)",
                    params![server, id, synced_at],
                )
            })
            .unwrap();
    }

    fn seed_track(store: &LibraryStore, server: &str, id: &str, artist_id: &str, deleted: bool) {
        store
            .with_conn_mut("test.seed_track", |c| {
                c.execute(
                    "INSERT INTO track (server_id, id, title, artist_id, album, \
                       duration_sec, deleted, synced_at, raw_json) \
                     VALUES (?1, ?2, 'Song', ?3, 'Al', 1, ?4, 1, '{}')",
                    params![server, id, artist_id, i64::from(deleted)],
                )
            })
            .unwrap();
    }

    fn artist_ids(store: &LibraryStore, server: &str) -> Vec<String> {
        store
            .with_read_conn(|c| {
                let mut stmt =
                    c.prepare("SELECT id FROM artist WHERE server_id = ?1 ORDER BY id")?;
                let rows = stmt
                    .query_map(params![server], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .unwrap()
    }

    #[test]
    fn prunes_renamed_away_artist_but_keeps_live_and_confirmed() {
        let store = LibraryStore::open_in_memory();
        // ar_new: confirmed this pass (fresh synced_at) + live track → keep.
        seed_artist(&store, "s1", "ar_new", 100);
        seed_track(&store, "s1", "tr_1", "ar_new", false);
        // ar_old: stale synced_at, only a soft-deleted track (renamed away) → prune.
        seed_artist(&store, "s1", "ar_old", 50);
        seed_track(&store, "s1", "tr_1_old", "ar_old", true);
        // ar_scopeb: stale synced_at but still backs a live track → keep.
        seed_artist(&store, "s1", "ar_scopeb", 50);
        seed_track(&store, "s1", "tr_2", "ar_scopeb", false);

        let removed = prune_orphan_artists_for_server(&store, "s1").unwrap();
        assert_eq!(removed, 1);
        assert_eq!(artist_ids(&store, "s1"), vec!["ar_new", "ar_scopeb"]);
    }

    #[test]
    fn keeps_album_artist_confirmed_this_pass_without_track_credit() {
        let store = LibraryStore::open_in_memory();
        // Various-Artists style row: no track credits its id, but it was just
        // confirmed by getArtists (shares the freshest synced_at) → keep.
        seed_artist(&store, "s1", "ar_va", 100);
        seed_artist(&store, "s1", "ar_real", 100);
        seed_track(&store, "s1", "tr_1", "ar_real", false);

        let removed = prune_orphan_artists_for_server(&store, "s1").unwrap();
        assert_eq!(removed, 0);
        assert_eq!(artist_ids(&store, "s1"), vec!["ar_real", "ar_va"]);
    }

    #[test]
    fn all_synced_at_equal_prunes_nothing() {
        // No authoritative "newer" pass to distinguish a ghost from a fresh
        // album-artist → cutoff equals every row, `synced_at < cutoff` is empty.
        let store = LibraryStore::open_in_memory();
        seed_artist(&store, "s1", "ar_a", 100);
        seed_artist(&store, "s1", "ar_b", 100);

        let removed = prune_orphan_artists_for_server(&store, "s1").unwrap();
        assert_eq!(removed, 0);
        assert_eq!(artist_ids(&store, "s1"), vec!["ar_a", "ar_b"]);
    }

    #[test]
    fn for_server_scopes_prune_to_a_single_server() {
        let store = LibraryStore::open_in_memory();
        seed_artist(&store, "s1", "ar_fresh", 100);
        seed_track(&store, "s1", "tr_1", "ar_fresh", false);
        seed_artist(&store, "s1", "ar_ghost", 50);
        seed_artist(&store, "s2", "ar_fresh2", 100);
        seed_track(&store, "s2", "tr_2", "ar_fresh2", false);
        seed_artist(&store, "s2", "ar_ghost2", 50);

        let removed = prune_orphan_artists_for_server(&store, "s1").unwrap();
        assert_eq!(removed, 1);
        assert_eq!(artist_ids(&store, "s1"), vec!["ar_fresh"]);
        assert_eq!(artist_ids(&store, "s2"), vec!["ar_fresh2", "ar_ghost2"]);
    }

    #[test]
    fn all_prune_sweeps_every_server() {
        let store = LibraryStore::open_in_memory();
        seed_artist(&store, "s1", "ar_fresh", 100);
        seed_track(&store, "s1", "tr_1", "ar_fresh", false);
        seed_artist(&store, "s1", "ar_ghost", 50);
        seed_artist(&store, "s2", "ar_fresh2", 100);
        seed_track(&store, "s2", "tr_2", "ar_fresh2", false);
        seed_artist(&store, "s2", "ar_ghost2", 50);

        let removed = store
            .with_conn_mut("test.all", |c| prune_orphan_artists_all(c))
            .unwrap();
        assert_eq!(removed, 2);
        assert_eq!(artist_ids(&store, "s1"), vec!["ar_fresh"]);
        assert_eq!(artist_ids(&store, "s2"), vec!["ar_fresh2"]);
    }
}
