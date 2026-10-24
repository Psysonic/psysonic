//! Paginated file mood -> track browse from the local mood projection.
//!
//! The mood predicate is intentionally expressed as a correlated `EXISTS`
//! against `track_mood`. That keeps the track row as the entity being paged
//! while letting SQLite use the projection primary key
//! `(server_id, track_id, mood COLLATE NOCASE)`.

use crate::dto::{
    multi_library_merge_enabled, ordered_library_scope_pairs, scoped_layer1_eligible,
    LibraryMoodTracksRequest, LibraryMoodTracksResponse, LibraryScopePair,
};
use crate::scope_merge;
use crate::store::LibraryStore;
use rusqlite::types::Value as SqlValue;

const TRACK_PAGE_MAX: u32 = 200;

pub(crate) fn mood_track_filter_sql() -> &'static str {
    "EXISTS ( \
       SELECT 1 FROM track_mood tm \
       WHERE tm.server_id = t.server_id \
         AND tm.track_id = t.id \
         AND tm.mood = ? COLLATE NOCASE \
     )"
}

fn effective_scopes(req: &LibraryMoodTracksRequest) -> Result<Vec<LibraryScopePair>, String> {
    let mut scopes = ordered_library_scope_pairs(
        &req.server_id,
        req.library_scope.as_deref(),
        req.library_scopes.as_deref(),
    )?;

    if scopes.is_empty() {
        let server_id = req.server_id.trim();
        if server_id.is_empty() {
            return Err("server_id must not be empty".into());
        }
        scopes.push(LibraryScopePair {
            server_id: server_id.to_string(),
            library_id: None,
        });
    }

    Ok(scopes)
}

/// Paginated tracks carrying one exact file mood.
///
/// The same scope engine used by ordinary track browse owns multi-library
/// selection and cross-server deduplication here. This is deliberately a
/// reusable track-level primitive so multi-mood intersection can extend the
/// predicate later without replacing the paging path.
pub fn list_tracks_by_mood(
    store: &LibraryStore,
    req: &LibraryMoodTracksRequest,
) -> Result<LibraryMoodTracksResponse, String> {
    let mood = req.mood.trim();
    if mood.is_empty() {
        return Ok(LibraryMoodTracksResponse {
            tracks: Vec::new(),
            has_more: false,
            total: req.include_total.then_some(0),
            source: "local".into(),
        });
    }

    let scopes = effective_scopes(req)?;
    if multi_library_merge_enabled(&scopes) {
        scope_merge::ensure_cluster_keys_for_scopes(store, &scopes)?;
    }

    let page_limit = req.limit.clamp(1, TRACK_PAGE_MAX);
    let query_limit = if req.count_only {
        1
    } else {
        page_limit.saturating_add(1)
    };
    let extra_where = mood_track_filter_sql();
    let extra_params = [SqlValue::Text(mood.to_string())];
    let skip_totals = !req.include_total;

    let (mut tracks, matching_total) =
        if scoped_layer1_eligible(&scopes) && !multi_library_merge_enabled(&scopes) {
            scope_merge::list_tracks_layer1_filtered(
                store,
                &scopes,
                extra_where,
                &extra_params,
                "ORDER BY t.title COLLATE NOCASE ASC, t.artist COLLATE NOCASE ASC, \
                      t.album COLLATE NOCASE ASC, t.id ASC",
                query_limit,
                req.offset,
                skip_totals,
                false,
                false,
            )?
        } else {
            scope_merge::list_tracks_filtered(
                store,
                &scopes,
                extra_where,
                &extra_params,
                "ORDER BY title COLLATE NOCASE ASC, artist COLLATE NOCASE ASC, \
                      album COLLATE NOCASE ASC, id ASC",
                query_limit,
                req.offset,
                skip_totals,
                false,
                false,
            )?
        };

    let total = req.include_total.then_some(matching_total);

    if req.count_only {
        return Ok(LibraryMoodTracksResponse {
            tracks: Vec::new(),
            has_more: false,
            total,
            source: "local".into(),
        });
    }

    let has_more = tracks.len() > page_limit as usize;
    tracks.truncate(page_limit as usize);

    Ok(LibraryMoodTracksResponse {
        tracks,
        has_more,
        total,
        source: "local".into(),
    })
}

#[cfg(test)]
#[path = "mood_track_browse/tests.rs"]
mod tests;
