//! ATTACH wiring for the rebuildable `library-cluster.db` sidecar.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

/// Fixed SQLite schema name for the attached identity database.
pub const CLUSTER_SCHEMA: &str = "cluster";

pub const CLUSTER_DB_FILENAME: &str = "library-cluster.db";
const CLUSTER_SCHEMA_VERSION: i64 = 2;

const CLUSTER_SCHEMA_SQL: &str = "
CREATE TABLE IF NOT EXISTS cluster.track_cluster_key (
  server_id    TEXT NOT NULL,
  library_id   TEXT NOT NULL,
  track_id     TEXT NOT NULL,
  cluster_key  TEXT,
  album_key    TEXT,
  artist_key   TEXT,
  duration_sec INTEGER,
  occurrence_rank INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, track_id)
);
CREATE INDEX IF NOT EXISTS cluster.idx_ck_scope_album
  ON track_cluster_key(server_id, library_id, album_key);
CREATE INDEX IF NOT EXISTS cluster.idx_ck_scope_artist
  ON track_cluster_key(server_id, library_id, artist_key);
CREATE INDEX IF NOT EXISTS cluster.idx_ck_scope_track
  ON track_cluster_key(server_id, library_id, cluster_key, duration_sec, occurrence_rank);
CREATE INDEX IF NOT EXISTS cluster.idx_ck_server_album
  ON track_cluster_key(server_id, album_key);
CREATE INDEX IF NOT EXISTS cluster.idx_ck_server_artist
  ON track_cluster_key(server_id, artist_key);
CREATE INDEX IF NOT EXISTS cluster.idx_ck_server_track
  ON track_cluster_key(server_id, cluster_key, duration_sec, occurrence_rank);
CREATE TABLE IF NOT EXISTS cluster.cluster_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
";

fn expected_schema_object(name: &str) -> bool {
    matches!(
        name,
        "track_cluster_key"
            | "cluster_meta"
            | "idx_ck_scope_album"
            | "idx_ck_scope_artist"
            | "idx_ck_scope_track"
            | "idx_ck_server_album"
            | "idx_ck_server_artist"
            | "idx_ck_server_track"
    )
}

fn cluster_schema_is_compatible(conn: &Connection) -> rusqlite::Result<bool> {
    let version: i64 = conn.query_row("PRAGMA cluster.user_version", [], |row| row.get(0))?;
    if version != 0 && version != CLUSTER_SCHEMA_VERSION {
        return Ok(false);
    }
    let mut statement = conn.prepare(
        "SELECT name FROM cluster.sqlite_master \
         WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'",
    )?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(names.iter().all(|name| expected_schema_object(name)))
}

fn initialize_cluster_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(CLUSTER_SCHEMA_SQL)?;
    conn.execute_batch(&format!(
        "PRAGMA cluster.user_version = {CLUSTER_SCHEMA_VERSION}"
    ))
}

pub fn cluster_db_path_for_library(library_db_path: &Path) -> PathBuf {
    library_db_path
        .parent()
        .map(|dir| dir.join(CLUSTER_DB_FILENAME))
        .unwrap_or_else(|| PathBuf::from(CLUSTER_DB_FILENAME))
}

fn escape_sqlite_literal(path: &str) -> String {
    path.replace('\'', "''")
}

/// Build a well-formed SQLite `file:` URI for a filesystem path so URI-mode
/// ATTACH works on every platform. A raw Windows path (`D:\dir\library-cluster.db`)
/// is not a valid URI — backslashes and the bare drive letter must become
/// `file:///D:/dir/library-cluster.db`. Query-significant characters are
/// percent-encoded so a path containing `?`/`#`/spaces cannot corrupt the URI.
fn file_uri(cluster_path: &Path, query: &str) -> String {
    let normalized = cluster_path.display().to_string().replace('\\', "/");
    let encoded: String = normalized
        .chars()
        .map(|c| match c {
            '%' => "%25".to_string(),
            '?' => "%3F".to_string(),
            '#' => "%23".to_string(),
            ' ' => "%20".to_string(),
            other => other.to_string(),
        })
        .collect();
    // Unix paths already start with `/` (→ `file://` + `/abs`); Windows paths
    // start with a drive letter and need the extra slash (`file:///C:/…`).
    let prefix = if encoded.starts_with('/') {
        "file://"
    } else {
        "file:///"
    };
    if query.is_empty() {
        format!("{prefix}{encoded}")
    } else {
        format!("{prefix}{encoded}?{query}")
    }
}

fn attach_file_write(conn: &Connection, cluster_path: &Path) -> rusqlite::Result<()> {
    if let Some(parent) = cluster_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    }
    let literal = escape_sqlite_literal(&cluster_path.display().to_string());
    conn.execute_batch(&format!("ATTACH DATABASE '{literal}' AS {CLUSTER_SCHEMA}"))?;
    if !cluster_schema_is_compatible(conn)? {
        crate::app_eprintln!(
            "[library-cluster] incompatible sidecar schema; recreating rebuildable database"
        );
        conn.execute_batch(&format!("DETACH DATABASE {CLUSTER_SCHEMA}"))?;
        remove_cluster_files(cluster_path);
        conn.execute_batch(&format!("ATTACH DATABASE '{literal}' AS {CLUSTER_SCHEMA}"))?;
    }
    initialize_cluster_schema(conn)
}

/// Read-only attach — only after the write connection has created the file + schema.
fn attach_file_read(conn: &Connection, cluster_path: &Path) -> rusqlite::Result<()> {
    // Bind the URI as a parameter (no literal quoting) and build it as a proper
    // `file:` URI so read-only attach also works on Windows.
    let uri = file_uri(cluster_path, "mode=ro");
    conn.execute(
        &format!("ATTACH DATABASE ?1 AS {CLUSTER_SCHEMA}"),
        rusqlite::params![uri],
    )?;
    Ok(())
}

/// Delete the cluster sidecar and its WAL/SHM siblings. Safe to call when they
/// do not exist. The identity DB is fully rebuildable, so removing it only costs
/// the next lazy rebuild.
pub fn remove_cluster_files(cluster_path: &Path) {
    let _ = std::fs::remove_file(cluster_path);
    let _ = std::fs::remove_file(cluster_path.with_extension("db-wal"));
    let _ = std::fs::remove_file(cluster_path.with_extension("db-shm"));
}

/// Remove the rebuildable cluster sidecar for a library DB path (swap / restore /
/// import must invalidate it — see store/backup). No-op if absent.
pub fn remove_cluster_files_for_library(library_db_path: &Path) {
    remove_cluster_files(&cluster_db_path_for_library(library_db_path));
}

/// Attach the identity sidecar on both handles with one-shot recovery: a corrupt
/// or partially-attached `library-cluster.db` is detached, deleted and recreated
/// (the file is fully rebuildable), so it can never block the library from
/// opening. Returns the second attach error only if recreation also fails.
pub fn attach_cluster_pair_file(
    write_conn: &Connection,
    read_conn: &Connection,
    library_db_path: &Path,
) -> rusqlite::Result<()> {
    let cluster_path = cluster_db_path_for_library(library_db_path);
    match attach_pair_once(write_conn, read_conn, &cluster_path) {
        Ok(()) => Ok(()),
        Err(first) => {
            crate::app_eprintln!(
                "[library-cluster] attach failed ({first}); recreating rebuildable sidecar"
            );
            let _ = write_conn.execute_batch(&format!("DETACH DATABASE {CLUSTER_SCHEMA}"));
            let _ = read_conn.execute_batch(&format!("DETACH DATABASE {CLUSTER_SCHEMA}"));
            remove_cluster_files(&cluster_path);
            attach_pair_once(write_conn, read_conn, &cluster_path)
        }
    }
}

fn attach_pair_once(
    write_conn: &Connection,
    read_conn: &Connection,
    cluster_path: &Path,
) -> rusqlite::Result<()> {
    attach_file_write(write_conn, cluster_path)?;
    attach_file_read(read_conn, cluster_path)?;
    Ok(())
}

/// In-memory cluster DB uses `cache=shared` so the read/write library pair see one identity store.
fn attach_memory(conn: &Connection, cluster_uri: &str) -> rusqlite::Result<()> {
    let literal = escape_sqlite_literal(cluster_uri);
    conn.execute_batch(&format!("ATTACH DATABASE '{literal}' AS {CLUSTER_SCHEMA}"))?;
    Ok(())
}

pub fn attach_cluster_write_file(
    conn: &Connection,
    library_db_path: &Path,
) -> rusqlite::Result<()> {
    attach_file_write(conn, &cluster_db_path_for_library(library_db_path))
}

pub fn attach_cluster_read_file(conn: &Connection, library_db_path: &Path) -> rusqlite::Result<()> {
    attach_file_read(conn, &cluster_db_path_for_library(library_db_path))
}

pub fn attach_cluster_write_memory(conn: &Connection, cluster_uri: &str) -> rusqlite::Result<()> {
    attach_memory(conn, cluster_uri)?;
    initialize_cluster_schema(conn)
}

/// Shared-cache in-memory identity DB — attach after write side created schema.
pub fn attach_cluster_read_memory(conn: &Connection, cluster_uri: &str) -> rusqlite::Result<()> {
    attach_memory(conn, cluster_uri)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_DB: AtomicU64 = AtomicU64::new(1);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let id = NEXT_TEST_DB.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "psysonic-cluster-{label}-{}-{id}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn library_path(&self) -> PathBuf {
            self.0.join("library.sqlite")
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn compatible_unversioned_sidecar_is_preserved_and_stamped() {
        let directory = TestDirectory::new("compatible");
        let library_path = directory.library_path();
        {
            let conn = Connection::open_in_memory().unwrap();
            attach_cluster_write_file(&conn, &library_path).unwrap();
            conn.execute(
                "INSERT INTO cluster.track_cluster_key( \
                   server_id, library_id, track_id, duration_sec \
                 ) VALUES ('s1', 'lib', 't1', 1)",
                [],
            )
            .unwrap();
            conn.execute_batch("PRAGMA cluster.user_version = 0; DETACH DATABASE cluster")
                .unwrap();
        }

        let conn = Connection::open_in_memory().unwrap();
        attach_cluster_write_file(&conn, &library_path).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cluster.track_cluster_key",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let version: i64 = conn
            .query_row("PRAGMA cluster.user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(version, CLUSTER_SCHEMA_VERSION);
    }

    #[test]
    fn incompatible_unversioned_sidecar_is_recreated() {
        let directory = TestDirectory::new("incompatible");
        let library_path = directory.library_path();
        {
            let conn = Connection::open_in_memory().unwrap();
            attach_cluster_write_file(&conn, &library_path).unwrap();
            conn.execute(
                "INSERT INTO cluster.track_cluster_key( \
                   server_id, library_id, track_id, duration_sec \
                 ) VALUES ('s1', 'lib', 't1', 1)",
                [],
            )
            .unwrap();
            conn.execute_batch(
                "CREATE TABLE cluster.obsolete_identity_source(id TEXT); \
                 PRAGMA cluster.user_version = 0; \
                 DETACH DATABASE cluster",
            )
            .unwrap();
        }

        let conn = Connection::open_in_memory().unwrap();
        attach_cluster_write_file(&conn, &library_path).unwrap();
        let key_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cluster.track_cluster_key",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let obsolete_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cluster.sqlite_master \
                 WHERE name = 'obsolete_identity_source'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let version: i64 = conn
            .query_row("PRAGMA cluster.user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(key_count, 0);
        assert_eq!(obsolete_count, 0);
        assert_eq!(version, CLUSTER_SCHEMA_VERSION);
    }

    #[test]
    fn version_one_sidecar_is_recreated_with_occurrence_rank() {
        let directory = TestDirectory::new("version-one");
        let library_path = directory.library_path();
        let cluster_path = cluster_db_path_for_library(&library_path);
        {
            let conn = Connection::open(&cluster_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE track_cluster_key ( \
                   server_id TEXT NOT NULL, library_id TEXT NOT NULL, track_id TEXT NOT NULL, \
                   cluster_key TEXT, album_key TEXT, artist_key TEXT, duration_sec INTEGER, \
                   PRIMARY KEY (server_id, track_id) \
                 ); \
                 CREATE TABLE cluster_meta (key TEXT PRIMARY KEY, value TEXT); \
                 INSERT INTO track_cluster_key(server_id, library_id, track_id) \
                 VALUES ('s1', 'lib', 'old'); \
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        }

        let conn = Connection::open_in_memory().unwrap();
        attach_cluster_write_file(&conn, &library_path).unwrap();
        let key_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cluster.track_cluster_key",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let rank_columns: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('track_cluster_key', 'cluster') \
                 WHERE name = 'occurrence_rank'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(key_count, 0);
        assert_eq!(rank_columns, 1);
    }

    #[test]
    fn versioned_sidecar_with_unknown_objects_is_recreated() {
        let directory = TestDirectory::new("versioned-incompatible");
        let library_path = directory.library_path();
        {
            let conn = Connection::open_in_memory().unwrap();
            attach_cluster_write_file(&conn, &library_path).unwrap();
            conn.execute_batch(
                "CREATE INDEX cluster.idx_abandoned_branch \
                   ON track_cluster_key(server_id, cluster_key); \
                 DETACH DATABASE cluster",
            )
            .unwrap();
        }

        let conn = Connection::open_in_memory().unwrap();
        attach_cluster_write_file(&conn, &library_path).unwrap();
        let unknown_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cluster.sqlite_master \
                 WHERE name = 'idx_abandoned_branch'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(unknown_count, 0);
    }
}
