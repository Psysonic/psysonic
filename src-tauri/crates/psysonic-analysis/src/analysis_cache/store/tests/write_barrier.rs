use super::*;

use psysonic_core::migration_write_barrier::MigrationWriteBarrier;

#[test]
fn ordinary_admission_tracks_the_shared_generation_and_restores_scope() {
    let barrier = Arc::new(MigrationWriteBarrier::default());
    let cache = AnalysisCache::open_in_memory_with_migration_barrier(Arc::clone(&barrier));
    cache.ensure_ordinary_write_allowed().unwrap();

    barrier.activate(7).unwrap();
    let blocked = "migration generation 7 blocks ordinary native writes";
    assert_eq!(cache.ensure_ordinary_write_allowed().unwrap_err(), blocked);

    AnalysisCache::scope_migration_write_generation_sync(7, || {
        cache.ensure_ordinary_write_allowed().unwrap();
        AnalysisCache::scope_migration_write_generation_sync(8, || {
            assert_eq!(cache.ensure_ordinary_write_allowed().unwrap_err(), blocked);
        });
        cache.ensure_ordinary_write_allowed().unwrap();
    });
    assert_eq!(cache.ensure_ordinary_write_allowed().unwrap_err(), blocked);

    barrier.deactivate(7).unwrap();
    cache.ensure_ordinary_write_allowed().unwrap();
}

#[test]
fn drain_requires_the_active_generation_and_releases_the_connection() {
    let barrier = Arc::new(MigrationWriteBarrier::default());
    let cache = AnalysisCache::open_in_memory_with_migration_barrier(Arc::clone(&barrier));
    assert_eq!(
        cache.drain_migration_writes(7).unwrap_err(),
        "analysis migration generation 7 is not active"
    );

    barrier.activate(7).unwrap();
    assert_eq!(
        cache.drain_migration_writes(8).unwrap_err(),
        "analysis migration generation 8 is not active"
    );
    cache.drain_migration_writes(7).unwrap();
    assert!(
        cache.conn.try_lock().is_ok(),
        "drain must release the connection"
    );

    barrier.deactivate(7).unwrap();
    assert_eq!(
        cache.drain_migration_writes(7).unwrap_err(),
        "analysis migration generation 7 is not active"
    );
}

#[test]
fn poisoned_connection_rejects_drain_and_authorized_writes() {
    let barrier = Arc::new(MigrationWriteBarrier::default());
    let cache = Arc::new(AnalysisCache::open_in_memory_with_migration_barrier(
        Arc::clone(&barrier),
    ));
    std::thread::scope(|scope| {
        let worker_cache = Arc::clone(&cache);
        let worker = scope.spawn(move || {
            let _conn = worker_cache.conn.lock().unwrap();
            panic!("poison the fixture-local analysis connection");
        });
        assert!(worker.join().is_err());
    });

    barrier.activate(7).unwrap();
    assert_eq!(
        cache.drain_migration_writes(7).unwrap_err(),
        "analysis_cache lock poisoned"
    );
    AnalysisCache::scope_migration_write_generation_sync(7, || {
        assert_eq!(
            cache
                .touch_track_status(&key("abc"), "pending")
                .unwrap_err(),
            "analysis_cache lock poisoned"
        );
    });
}
