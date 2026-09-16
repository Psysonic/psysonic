//! Bounded random artist samples for local-only Home discovery.

use rusqlite::params;

use crate::dto::LibraryArtistDto;
use crate::store::LibraryStore;

pub const RANDOM_ARTISTS_LIMIT: u32 = 50;

pub fn list_random_artists(
    store: &LibraryStore,
    server_id: &str,
    limit: Option<u32>,
) -> Result<Vec<LibraryArtistDto>, String> {
    let limit = limit
        .unwrap_or(RANDOM_ARTISTS_LIMIT)
        .clamp(1, RANDOM_ARTISTS_LIMIT);
    let (artists, timing) = store
        .with_read_conn_timed(|conn| {
            let mut stmt = conn.prepare(
                "SELECT server_id, id, name, name_sort, album_count, synced_at, raw_json \
                 FROM artist WHERE server_id = ?1 ORDER BY RANDOM() LIMIT ?2",
            )?;
            let rows = stmt
                .query_map(params![server_id, i64::from(limit)], |row| {
                    let raw_json = row
                        .get::<_, Option<String>>(6)?
                        .and_then(|raw| serde_json::from_str(&raw).ok())
                        .unwrap_or(serde_json::Value::Null);
                    Ok(LibraryArtistDto {
                        server_id: row.get(0)?,
                        id: row.get(1)?,
                        name: row.get(2)?,
                        name_sort: row.get(3)?,
                        album_count: row.get(4)?,
                        synced_at: row.get(5)?,
                        raw_json,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>();
            rows
        })
        .map_err(|error| error.to_string())?;
    let blocked_by = timing
        .blocked_by
        .map(|owner| format!("{}:{}", owner.file, owner.line))
        .unwrap_or_else(|| "none".to_string());
    crate::app_deprintln!(
        "[library-db][random-artists] server={} lock_wait_ms={} query_ms={} blocked_by={}",
        server_id,
        timing.lock_wait_ms,
        timing.exec_ms,
        blocked_by,
    );
    Ok(artists)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_artists(store: &LibraryStore, server_id: &str, count: u32) {
        store
            .with_conn_mut("random_artists.test", |conn| {
                for index in 0..count {
                    conn.execute(
                    "INSERT INTO artist (server_id, id, name, synced_at) VALUES (?1, ?2, ?3, 1)",
                    params![server_id, format!("artist-{index}"), format!("Artist {index}")],
                )?;
                }
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn samples_only_the_requested_server() {
        let store = LibraryStore::open_in_memory();
        insert_artists(&store, "server-a", 5);
        insert_artists(&store, "server-b", 5);

        let artists = list_random_artists(&store, "server-a", Some(5)).unwrap();

        assert_eq!(artists.len(), 5);
        assert!(artists.iter().all(|artist| artist.server_id == "server-a"));
    }

    #[test]
    fn caps_the_sample_to_fifty_rows() {
        let store = LibraryStore::open_in_memory();
        insert_artists(&store, "server-a", RANDOM_ARTISTS_LIMIT + 10);

        let artists = list_random_artists(&store, "server-a", Some(500)).unwrap();

        assert_eq!(artists.len(), RANDOM_ARTISTS_LIMIT as usize);
    }
}
