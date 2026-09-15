use rusqlite::OptionalExtension;
use std::time::{Duration, Instant};

use super::*;

const PERF_SAMPLE_COUNT: usize = 5;

fn initial_ingest_rows() -> Vec<TrackRow> {
    (0..500)
        .map(|i| {
            let mut r = row("s1", &format!("t{i:04}"), &format!("Track {i:04}"));
            r.server_path = Some(format!("/music/track{i:04}.flac"));
            r.isrc = Some(format!("USRC{i:06}"));
            r.raw_json = format!(r#"{{"id":"t{i:04}","payload":"#) + &"x".repeat(512) + r#""}"#;
            r
        })
        .collect()
}

fn upsert_rows() -> Vec<TrackRow> {
    (0..500)
        .map(|i| row("s1", &format!("t{i:04}"), &format!("Track {i:04}")))
        .collect()
}

fn median_duration(mut sample: impl FnMut() -> Duration) -> (Duration, Vec<Duration>) {
    let mut samples: Vec<Duration> = (0..PERF_SAMPLE_COUNT).map(|_| sample()).collect();
    samples.sort_unstable();
    (samples[PERF_SAMPLE_COUNT / 2], samples)
}

#[test]
fn upsert_inserts_new_rows() {
    let store = LibraryStore::open_in_memory();
    let repo = TrackRepository::new(&store);
    repo.upsert_batch(&[row("s1", "t1", "First"), row("s1", "t2", "Second")])
        .unwrap();
    let count: i64 = store
        .with_conn("misc", |c| {
            c.query_row("SELECT COUNT(*) FROM track", [], |r| r.get(0))
        })
        .unwrap();
    assert_eq!(count, 2);
}

#[test]
fn upsert_updates_existing_rows() {
    let store = LibraryStore::open_in_memory();
    let repo = TrackRepository::new(&store);
    repo.upsert_batch(&[row("s1", "t1", "Original")]).unwrap();

    let mut updated = row("s1", "t1", "Updated");
    updated.bpm = Some(128);
    updated.starred_at = Some(1_700_000_999);
    repo.upsert_batch(&[updated]).unwrap();

    let (title, bpm, starred): (String, Option<i64>, Option<i64>) = store
        .with_conn("misc", |c| {
            c.query_row(
                "SELECT title, bpm, starred_at FROM track WHERE server_id='s1' AND id='t1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
        })
        .unwrap();
    assert_eq!(title, "Updated");
    assert_eq!(bpm, Some(128));
    assert_eq!(starred, Some(1_700_000_999));

    let count: i64 = store
        .with_conn("misc", |c| {
            c.query_row("SELECT COUNT(*) FROM track", [], |r| r.get(0))
        })
        .unwrap();
    assert_eq!(count, 1, "upsert must not duplicate the row");
}

#[test]
fn upsert_empty_batch_is_noop() {
    let store = LibraryStore::open_in_memory();
    let repo = TrackRepository::new(&store);
    repo.upsert_batch(&[]).unwrap();
}

#[test]
fn upsert_keeps_server_scope_separate() {
    // Same `id` on two different servers must produce two rows
    // (PRIMARY KEY is composite).
    let store = LibraryStore::open_in_memory();
    let repo = TrackRepository::new(&store);
    repo.upsert_batch(&[row("s1", "t1", "From S1"), row("s2", "t1", "From S2")])
        .unwrap();
    let count: i64 = store
        .with_conn("misc", |c| {
            c.query_row("SELECT COUNT(*) FROM track", [], |r| r.get(0))
        })
        .unwrap();
    assert_eq!(count, 2);
}

#[test]
fn upsert_populates_fts_via_trigger() {
    let store = LibraryStore::open_in_memory();
    let repo = TrackRepository::new(&store);
    repo.upsert_batch(&[row("s1", "t1", "Aurora Boreal")])
        .unwrap();
    let fts_hit: i64 = store
        .with_conn("misc", |c| {
            c.query_row(
                "SELECT COUNT(*) FROM track_fts WHERE track_fts MATCH 'aurora'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(fts_hit, 1);
}

#[test]
fn upsert_update_refreshes_fts_via_trigger() {
    let store = LibraryStore::open_in_memory();
    let repo = TrackRepository::new(&store);
    repo.upsert_batch(&[row("s1", "t1", "Old Title")]).unwrap();
    repo.upsert_batch(&[row("s1", "t1", "Brand New Title")])
        .unwrap();

    let old_hit: i64 = store
        .with_conn("misc", |c| {
            c.query_row(
                "SELECT COUNT(*) FROM track_fts WHERE track_fts MATCH 'old'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    let new_hit: i64 = store
        .with_conn("misc", |c| {
            c.query_row(
                "SELECT COUNT(*) FROM track_fts WHERE track_fts MATCH 'brand'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(old_hit, 0, "delete-trigger must drop the stale FTS row");
    assert_eq!(new_hit, 1);
}

#[test]
fn initial_ingest_batch_skips_remap_and_canonical() {
    let store = LibraryStore::open_in_memory();
    let repo = TrackRepository::new(&store);
    let rows = initial_ingest_rows();
    repo.upsert_batch_initial_ingest(&rows).unwrap();

    let (stored, canonical_links): (i64, i64) = store
        .with_conn("misc", |c| {
            Ok((
                c.query_row("SELECT COUNT(*) FROM track", [], |r| r.get(0))?,
                c.query_row("SELECT COUNT(*) FROM track_canonical_link", [], |r| {
                    r.get(0)
                })?,
            ))
        })
        .unwrap();
    assert_eq!(stored, 500);
    assert_eq!(
        canonical_links, 0,
        "initial ingest must defer canonical linking"
    );
}

#[test]
fn upsert_500_rows_inserts_all_rows() {
    let store = LibraryStore::open_in_memory();
    let rows = upsert_rows();
    TrackRepository::new(&store).upsert_batch(&rows).unwrap();

    let stored: i64 = store
        .with_conn("misc", |c| {
            c.query_row("SELECT COUNT(*) FROM track", [], |r| r.get(0))
        })
        .unwrap();
    assert_eq!(stored, 500);
}

#[test]
#[ignore = "wall-clock performance gate; run isolated with --test-threads=1"]
fn initial_ingest_500_rows_meets_perf_budget() {
    let (median, samples) = median_duration(|| {
        let store = LibraryStore::open_in_memory();
        let rows = initial_ingest_rows();
        let started = Instant::now();
        TrackRepository::new(&store)
            .upsert_batch_initial_ingest(&rows)
            .unwrap();
        started.elapsed()
    });

    let budget = Duration::from_millis(1000);
    eprintln!("initial_ingest_batch(500): median={median:?}, samples={samples:?}");
    assert!(
        median < budget,
        "median initial ingest time {median:?} exceeds {budget:?}; samples: {samples:?}"
    );
}

#[test]
#[ignore = "wall-clock performance gate; run isolated with --test-threads=1"]
fn upsert_500_rows_meets_perf_budget() {
    // Spec §5.1 / AC A3: `upsert_batch` should land 500 rows under 100ms
    // typical. The isolated CI threshold remains 5× that to absorb slow
    // runners and the difference between debug and release builds.
    let (median, samples) = median_duration(|| {
        let store = LibraryStore::open_in_memory();
        let rows = upsert_rows();
        let started = Instant::now();
        TrackRepository::new(&store).upsert_batch(&rows).unwrap();
        started.elapsed()
    });

    let budget = Duration::from_millis(500);
    eprintln!("upsert_batch(500): median={median:?}, samples={samples:?}");
    assert!(
        median < budget,
        "median upsert time {median:?} exceeds {budget:?}; AC A3 target is <100ms typical; \
         samples: {samples:?}"
    );
}

// ── H2: canonical linking on the upsert path (§5.5A) ───────────────

#[test]
fn upsert_links_track_to_canonical_by_isrc() {
    let store = LibraryStore::open_in_memory();
    let mut r = row("s1", "t1", "Title");
    r.isrc = Some("USRC100".into());
    TrackRepository::new(&store).upsert_batch(&[r]).unwrap();
    let cid: Option<String> = store
        .with_conn("misc", |c| {
            c.query_row(
                "SELECT canonical_id FROM track_canonical_link \
                 WHERE server_id='s1' AND track_id='t1'",
                [],
                |r| r.get(0),
            )
            .optional()
        })
        .unwrap();
    assert_eq!(cid.as_deref(), Some("isrc:USRC100"));
}

#[test]
fn upsert_shares_canonical_across_servers_with_same_isrc() {
    let store = LibraryStore::open_in_memory();
    let mut a = row("s1", "t1", "T");
    a.isrc = Some("USRC200".into());
    let mut b = row("s2", "t9", "T");
    b.isrc = Some("USRC200".into());
    TrackRepository::new(&store).upsert_batch(&[a, b]).unwrap();
    let distinct: i64 = store
        .with_conn("misc", |c| {
            c.query_row(
                "SELECT COUNT(DISTINCT canonical_id) FROM track_canonical_link",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(distinct, 1, "same ISRC on two servers → one canonical id");
}

#[test]
fn upsert_without_strong_key_creates_no_canonical_link() {
    let store = LibraryStore::open_in_memory();
    // `row(...)` leaves isrc / mbid_recording as None.
    TrackRepository::new(&store)
        .upsert_batch(&[row("s1", "t1", "T")])
        .unwrap();
    let count: i64 = store
        .with_conn("misc", |c| {
            c.query_row("SELECT COUNT(*) FROM track_canonical_link", [], |r| {
                r.get(0)
            })
        })
        .unwrap();
    assert_eq!(count, 0);
}
