use super::artist_albums::fetch_albums_for_artist_key;
use super::artist_candidates::{fetch_artist_candidates, merge_artist_by_priority};
use super::artist_tracks::{
    fetch_scope_deduped_tracks_for_artist_key, fetch_top_tracks_fingerprint,
    fetch_top_tracks_server_id,
};
use super::common::{ensure_cluster_keys_for_all_scopes, non_empty_scopes};
use super::entity_sources::{lookup_artist_name, lookup_artist_row, resolve_artist_detail_anchor};
use crate::album_compilation_filter::{album_credits_artist, various_artists_label};
use crate::browse_support::overlay_album_artist_links;
use crate::dto::{LibraryScopeArtistDetailRequest, LibraryScopeArtistDetailResponse};
use crate::store::LibraryStore;

/// `library_scope_artist_detail` — resolve anchor → `artist_key`, aggregate albums + tracks.
pub fn artist_detail(
    store: &LibraryStore,
    request: &LibraryScopeArtistDetailRequest,
) -> Result<LibraryScopeArtistDetailResponse, String> {
    let scopes = non_empty_scopes(&request.scopes)?;
    ensure_cluster_keys_for_all_scopes(store, scopes)?;
    let server_id = request.server_id.trim();
    let artist_id = request.artist_id.trim();
    if server_id.is_empty() || artist_id.is_empty() {
        return Err("server_id and artist_id are required".into());
    }

    store.with_scope_detail_read_conn(|conn| {
        let (canonical_artist_id, artist_key) =
            resolve_artist_detail_anchor(conn, server_id, artist_id)?;
        let mut candidates = fetch_artist_candidates(
            conn,
            scopes,
            artist_key.as_deref(),
            server_id,
            &canonical_artist_id,
        )?;
        candidates.sort_by_key(|a| {
            scopes
                .iter()
                .position(|p| p.server_id == a.server_id)
                .unwrap_or(usize::MAX) as i64
        });
        // `va_mode` decides from the anchor's canonical name (a name-only query on the
        // hot path — no `raw_json` parse), falling back to the track-derived header.
        let anchor_name = lookup_artist_name(conn, server_id, &canonical_artist_id)?;
        let mut artist = merge_artist_by_priority(&candidates);
        let va_mode = anchor_name
            .as_deref()
            .map(various_artists_label)
            .unwrap_or_else(|| various_artists_label(&artist.name));
        // The track-derived album set contains both the artist's own releases and
        // every album they only appear on (Various Artists / curated compilations,
        // other artists' albums with a guest track). Split by the canonical album
        // artist so the frontend can render "appears on" separately from the main
        // discography — locally, so it stays correct under multi-server scopes and
        // needs no network search (the old featured-albums path was network-only
        // and disabled for multi-server).
        let all_albums = fetch_albums_for_artist_key(
            conn,
            scopes,
            artist_key.as_deref(),
            server_id,
            &canonical_artist_id,
            va_mode,
        )?;
        // Track-less headers are valid only when the selected scope supplied positive
        // album evidence: VA label matches or structured participant credits. A plain
        // scoped miss stays empty so the frontend cannot escape the authoritative scope.
        if candidates.is_empty() && (va_mode || !all_albums.is_empty()) {
            if let Some(row) = lookup_artist_row(conn, server_id, &canonical_artist_id)? {
                candidates.push(row);
                artist = merge_artist_by_priority(&candidates);
            }
        }
        let (own, appears_on): (Vec<_>, Vec<_>) = all_albums.into_iter().partition(|(_, meta)| {
            // The "Various Artists" pseudo-entity has no discography of its own to
            // separate an appears-on set from: every album on that page *is* a
            // compilation it heads. Splitting there would eject exactly the albums
            // the VA union arm gathered — an id-tagged compilation with an empty
            // `album_artist` carries a compilation signal and would be routed away.
            if va_mode {
                return true;
            }
            // Own = the album credits this artist as its album artist. A single-artist
            // compilation the artist owns (their own best-of, tagged album_artist = the
            // artist) therefore stays in the main discography and lands in the
            // frontend's "Compilation" release-type group.
            match meta.album_artist.as_deref() {
                // Tagged album: the tag is authoritative, so compare against it.
                Some(tag) => album_credits_artist(Some(tag), &artist.name),
                // Untagged album (S2 ingest, or simply untagged files): there is no
                // album-artist claim to weigh, and the album is only in this set
                // because the artist's own tracks carry this artist's `artist_id` —
                // the strongest signal available. Do NOT second-guess that with a name
                // comparison: a server's artist row and its track tag routinely differ
                // in spelling ("Die drei ???" vs "Die Drei Fragezeichen"), which would
                // exile an artist's entire catalogue. Only a compilation signal, which
                // is about the album rather than the spelling, routes it to appears-on.
                None => !meta.is_compilation && !meta.participant_only,
            }
        });
        let mut albums: Vec<_> = own.into_iter().map(|(al, _)| al).collect();
        let mut appears_on_albums: Vec<_> = appears_on.into_iter().map(|(al, _)| al).collect();
        // Resolve each card's album-artist link against the whole physical album, for
        // both halves of the split: an appears-on card is exactly the case where the
        // representative row is the viewed artist's guest track, so its credit would
        // otherwise link to that guest instead of the album's headliner.
        overlay_album_artist_links(conn, &mut albums);
        overlay_album_artist_links(conn, &mut appears_on_albums);
        // Browse counts every unique credited album before the own / appears-on split.
        // Keep the detail count on the same contract so a merged participant alias does
        // not advertise 31 albums in the card and 29 after navigation.
        artist.album_count = Some((albums.len() + appears_on_albums.len()) as i64);
        let tracks = if request.include_tracks {
            fetch_scope_deduped_tracks_for_artist_key(
                conn,
                scopes,
                artist_key.as_deref(),
                server_id,
                &canonical_artist_id,
                request.top_tracks_limit,
            )?
        } else {
            Vec::new()
        };
        let (top_tracks_server_id, top_tracks_fingerprint) = if request.top_tracks_limit.is_some() {
            let source_server_id = fetch_top_tracks_server_id(
                conn,
                scopes,
                artist_key.as_deref(),
                server_id,
                &canonical_artist_id,
            )?;
            let fingerprint = if source_server_id.is_some() {
                Some(fetch_top_tracks_fingerprint(
                    conn,
                    scopes,
                    artist_key.as_deref(),
                    server_id,
                    &canonical_artist_id,
                )?)
            } else {
                None
            };
            (source_server_id, fingerprint)
        } else {
            (None, None)
        };
        Ok(LibraryScopeArtistDetailResponse {
            artist,
            albums,
            appears_on_albums,
            tracks,
            top_tracks_server_id,
            top_tracks_fingerprint,
        })
    })
}
