use super::*;

fn check_live_cycle(with_hashes: bool, reverse: bool, limit: u32) {
    let store = LibraryStore::open_in_memory();
    let ids = ["XNMKOIuyafuxBspGhlKfWq", "hAvxWe5AT4DBwzdmOdTiAd"];
    let order = if reverse { [1, 0] } else { [0, 1] };
    store
        .with_conn_mut("test.seed_live_alias_cycle", |conn| {
            for index in order {
                let id = ids[index];
                let hash = with_hashes.then(|| format!("hash-{index}"));
                conn.execute(
                    "INSERT INTO track \
                       (server_id, id, title, album, content_hash, play_count, \
                        deleted, synced_at, raw_json) \
                     VALUES ('s1', ?1, ?2, 'Album', ?3, ?4, 0, 1, ?5)",
                    params![
                        id,
                        format!("Track {index}"),
                        hash,
                        index as i64 + 7,
                        serde_json::json!({"id": id, "owner": index}).to_string()
                    ],
                )?;
                conn.execute(
                    "INSERT INTO track_id_history (server_id, old_id, new_id, remapped_at) \
                     VALUES ('s1', ?1, ?2, 1)",
                    params![id, ids[1 - index]],
                )?;
                conn.execute(
                    "INSERT INTO play_session \
                       (server_id, track_id, started_at_ms, listened_sec, position_max_sec, \
                        completion, end_reason) \
                     VALUES ('s1', ?1, ?2, 10, 10, 'full', 'ended')",
                    params![id, index as i64 + 1],
                )?;
                conn.execute(
                    "INSERT INTO entity_user_rating \
                       (server_id, entity_kind, entity_id, rating, fetched_at) \
                     VALUES ('s1', 'track', ?1, ?2, 1)",
                    params![id, index as i64 + 3],
                )?;
                conn.execute(
                    "INSERT INTO track_offline \
                       (server_id, track_id, local_path, cached_at) \
                     VALUES ('s1', ?1, ?2, 1)",
                    params![id, format!("/fixture/{index}.flac")],
                )?;
            }
            Ok(())
        })
        .unwrap();

    preflight(&store, "s1").unwrap();
    assert_eq!(run_track_batches(&store, limit), (2, 0));
    for (index, id) in ids.iter().enumerate() {
        let canonical = canonical_id(id);
        assert_ne!(&canonical, id);
        let state: (
            String,
            Option<String>,
            i64,
            String,
            String,
            i64,
            String,
            String,
        ) = store
            .with_read_conn(|conn| {
                conn.query_row(
                    "SELECT title, content_hash, play_count, raw_json, \
                       (SELECT track_id FROM play_session WHERE started_at_ms = ?3), \
                       (SELECT rating FROM entity_user_rating \
                        WHERE server_id = 's1' AND entity_kind = 'track' AND entity_id = ?1), \
                       (SELECT local_path FROM track_offline \
                        WHERE server_id = 's1' AND track_id = ?1), \
                       (SELECT new_id FROM track_id_history \
                        WHERE server_id = 's1' AND old_id = ?2) \
                     FROM track WHERE server_id = 's1' AND id = ?1 AND deleted = 0",
                    params![canonical, id, index as i64 + 1],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                            row.get(6)?,
                            row.get(7)?,
                        ))
                    },
                )
            })
            .unwrap();
        assert_eq!(state.0, format!("Track {index}"));
        assert_eq!(state.1, with_hashes.then(|| format!("hash-{index}")));
        assert_eq!(state.2, index as i64 + 7);
        let payload: serde_json::Value = serde_json::from_str(&state.3).unwrap();
        assert_eq!(payload["id"], canonical);
        assert_eq!(payload["owner"], index);
        assert_eq!(state.4, canonical);
        assert_eq!(state.5, index as i64 + 3);
        assert_eq!(state.6, format!("/fixture/{index}.flac"));
        assert_eq!(state.7, canonical);
    }
    let count: i64 = store
        .with_read_conn(|conn| conn.query_row("SELECT COUNT(*) FROM track", [], |row| row.get(0)))
        .unwrap();
    assert_eq!(count, 2);
    // Retrying the entrypoints must neither re-merge owners nor restore the cycle.
    preflight(&store, "s1").unwrap();
    assert_eq!(run_track_batches(&store, limit), (0, 0));
}

#[test]
fn live_alias_cycle_preserves_distinct_hashes() {
    for reverse in [false, true] {
        for limit in [1, 2, 20] {
            check_live_cycle(true, reverse, limit);
        }
    }
}

#[test]
fn live_alias_cycle_does_not_merge_without_strong_ids() {
    for reverse in [false, true] {
        for limit in [1, 2, 20] {
            check_live_cycle(false, reverse, limit);
        }
    }
}

#[test]
fn live_alias_cycle_cleanup_rolls_back_with_the_batch() {
    let store = LibraryStore::open_in_memory();
    let ids = ["XNMKOIuyafuxBspGhlKfWq", "hAvxWe5AT4DBwzdmOdTiAd"];
    store
        .with_conn_mut("test.seed_live_cycle_rollback", |conn| {
            for (index, id) in ids.iter().enumerate() {
                conn.execute(
                    "INSERT INTO track (server_id, id, title, album, synced_at, raw_json) \
                     VALUES ('s1', ?1, 'Track', 'Album', 1, '{}')",
                    params![id],
                )?;
                conn.execute(
                    "INSERT INTO track_id_history (server_id, old_id, new_id, remapped_at) \
                     VALUES ('s1', ?1, ?2, 1)",
                    params![id, ids[1 - index]],
                )?;
            }
            conn.execute(
                "INSERT INTO play_session \
                   (server_id, track_id, started_at_ms, listened_sec, position_max_sec, \
                    completion, end_reason) \
                 VALUES ('s1', ?1, 1, 10, 10, 'full', 'ended')",
                params![ids[0]],
            )?;
            conn.execute_batch(
                "CREATE TRIGGER fail_live_cycle_retarget BEFORE UPDATE ON play_session \
                 BEGIN SELECT RAISE(ABORT, 'fixture retarget failure'); END;",
            )
        })
        .unwrap();
    preflight(&store, "s1").unwrap();
    let upper = upper_rowid(&store, "s1", NavidromeNativeMigrationStep::Track).unwrap();
    let error = run_batch(
        &store,
        "s1",
        NavidromeNativeMigrationStep::Track,
        0,
        upper,
        1,
    )
    .unwrap_err();
    assert!(error.contains("fixture retarget failure"));
    for (index, id) in ids.iter().enumerate() {
        let state: (String, bool) = store
            .with_read_conn(|conn| {
                conn.query_row(
                "SELECT new_id, EXISTS(SELECT 1 FROM track WHERE server_id = 's1' AND id = ?1) \
                 FROM track_id_history WHERE server_id = 's1' AND old_id = ?1",
                params![id], |row| Ok((row.get(0)?, row.get(1)?)),
            )
            })
            .unwrap();
        assert_eq!(state, (ids[1 - index].to_string(), true));
    }
    store
        .with_conn_mut("test.allow_live_cycle_retry", |conn| {
            conn.execute_batch("DROP TRIGGER fail_live_cycle_retarget")
        })
        .unwrap();
    assert_eq!(run_track_batches(&store, 1), (2, 0));
}
