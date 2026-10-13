use super::*;

#[test]
fn library_tier_roundtrip() {
    let store = LibraryStore::open_in_memory();
    let repo = SyncStateRepository::new(&store);
    repo.set_library_tier("s1", "", "huge").unwrap();
    let tier: String = store
        .with_conn("misc", |c| {
            c.query_row(
                "SELECT library_tier FROM sync_state WHERE server_id = 's1'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(tier, "huge");
}

#[test]
fn stored_errors_lose_their_credentials_and_keep_the_rest() {
    let store = LibraryStore::open_in_memory();
    let leaked = "sync transport: error sending request for url \
        (https://music.example.com/rest/getArtists.view?u=alice&t=tok123&s=salt456&f=json) \
        | tls handshake eof";
    store
        .with_conn("seed", |c| {
            c.execute(
                "INSERT INTO sync_state (server_id, library_scope, last_error) VALUES \
                 ('s1', '', ?1), ('s2', '', 'storage: disk full'), ('s3', '', NULL)",
                [leaked],
            )
        })
        .unwrap();

    let repo = SyncStateRepository::new(&store);
    assert_eq!(repo.redact_last_errors().unwrap(), 1);
    assert_eq!(repo.redact_last_errors().unwrap(), 0);

    let errors: Vec<Option<String>> = store
        .with_conn("read", |c| {
            let mut statement =
                c.prepare("SELECT last_error FROM sync_state ORDER BY server_id")?;
            let rows = statement.query_map([], |r| r.get(0))?;
            rows.collect()
        })
        .unwrap();
    let first = errors[0].as_deref().unwrap();
    assert!(first.contains("music.example.com/rest/getArtists.view?u=alice&t=REDACTED&s=REDACTED"));
    assert!(first.ends_with("| tls handshake eof"));
    assert!(!first.contains("tok123") && !first.contains("salt456"));
    assert_eq!(errors[1].as_deref(), Some("storage: disk full"));
    assert_eq!(errors[2], None);
}
