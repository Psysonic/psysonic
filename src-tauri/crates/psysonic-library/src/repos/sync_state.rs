mod capability;
mod cursor_state;
mod phase;
mod scheduling;
mod watermark_count;

#[cfg(test)]
mod tests;

use rusqlite::params;

use crate::store::LibraryStore;

/// Repository over the `sync_state` row identified by `(server_id, library_scope)`.
/// PR-1b exposes just enough of the row to drive resumable initial sync — the
/// orchestrator-side helpers (poll stats, phase transitions, …) land with
/// PR-3 when there's actual sync code to consume them.
pub struct SyncStateRepository<'a> {
    store: &'a LibraryStore,
}

impl<'a> SyncStateRepository<'a> {
    pub fn new(store: &'a LibraryStore) -> Self {
        Self { store }
    }

    /// Read-only queries — must not take the write mutex (ingest holds it for
    /// long stretches during IS-3).
    fn read<R>(
        &self,
        f: impl FnOnce(&rusqlite::Connection) -> rusqlite::Result<R>,
    ) -> Result<R, String> {
        self.store.with_read_conn(f)
    }

    /// Insert a default-valued row for this `(server_id, library_scope)` pair
    /// if none exists. All non-PK columns fall back to their schema DEFAULTs
    /// (`sync_phase='idle'`, `initial_sync_cursor_json='{}'`, …).
    pub fn ensure(&self, server_id: &str, library_scope: &str) -> Result<(), String> {
        self.store.with_conn("sync_state.ensure", |conn| {
            conn.execute(
                "INSERT OR IGNORE INTO sync_state (server_id, library_scope) VALUES (?1, ?2)",
                params![server_id, library_scope],
            )?;
            Ok(())
        })
    }

    /// Errors stored before they were redacted can carry a Subsonic request URL
    /// with its token and salt. Rewrite those once; an error recorded in the
    /// meantime is left alone.
    pub fn redact_last_errors(&self) -> Result<usize, String> {
        let stored: Vec<(String, String, String)> = self.read(|conn| {
            let mut statement = conn.prepare(
                "SELECT server_id, library_scope, last_error FROM sync_state \
                 WHERE last_error IS NOT NULL",
            )?;
            let rows =
                statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
            rows.collect()
        })?;
        let rewrites: Vec<_> = stored
            .into_iter()
            .filter_map(|(server_id, library_scope, error)| {
                let redacted = psysonic_core::log_sanitize::redact_secrets(&error);
                (redacted != error).then_some((server_id, library_scope, error, redacted))
            })
            .collect();
        if rewrites.is_empty() {
            return Ok(0);
        }
        self.store
            .with_conn("sync_state.redact_last_errors", |conn| {
                let mut rewritten = 0;
                for (server_id, library_scope, error, redacted) in &rewrites {
                    rewritten += conn.execute(
                        "UPDATE sync_state SET last_error = ?4 \
                     WHERE server_id = ?1 AND library_scope = ?2 AND last_error = ?3",
                        params![server_id, library_scope, error, redacted],
                    )?;
                }
                Ok(rewritten)
            })
    }
}
