//! Playlist CRUD via Navidrome's native REST API. The smart-playlist rules
//! payload is forwarded as-is so the frontend can compose any rule the
//! Navidrome version supports without backend changes.

use std::sync::Arc;

use psysonic_core::server_http::ServerHttpRegistry;
use tauri::State;

use super::client::{nd_apply_request, nd_err, nd_http_client, nd_retry};

/// GET `/api/playlist` — list playlists; pass `smart=true` to filter smart playlists.
// NOT specta-collected: serde_json::Value in the command signature — specta rc.25 can't export it. Stays hand-written on generate_handler!.
#[tauri::command]
pub async fn nd_list_playlists(
    http_registry: State<'_, Arc<ServerHttpRegistry>>,
    server_url: String,
    token: String,
    smart: Option<bool>,
) -> Result<serde_json::Value, String> {
    let reg = http_registry.as_ref();
    let base = format!("{}/api/playlist", server_url);
    let auth = format!("Bearer {}", token);
    let resp = nd_retry(|| {
        let base = base.clone();
        let auth = auth.clone();
        async move {
            let mut req = nd_apply_request(
                Some(reg),
                None,
                &base,
                nd_http_client()
                    .get(&base)
                    .header("X-ND-Authorization", auth),
            );
            if let Some(s) = smart {
                req = req.query(&[("smart", s)]);
            }
            req.send().await
        }
    })
    .await?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<serde_json::Value>().await.map_err(nd_err)
}

/// POST `/api/playlist` — create playlist (supports smart rules payload).
// NOT specta-collected: serde_json::Value in the command signature — specta rc.25 can't export it. Stays hand-written on generate_handler!.
#[tauri::command]
pub async fn nd_create_playlist(
    http_registry: State<'_, Arc<ServerHttpRegistry>>,
    server_url: String,
    token: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    create_playlist(http_registry.as_ref(), &server_url, &token, body).await
}

async fn create_playlist(
    reg: &ServerHttpRegistry,
    server_url: &str,
    token: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/api/playlist", server_url);
    let auth = format!("Bearer {}", token);
    let resp = nd_retry(|| {
        let url = url.clone();
        let auth = auth.clone();
        let body = body.clone();
        async move {
            nd_apply_request(
                Some(reg),
                None,
                &url,
                nd_http_client()
                    .post(&url)
                    .header("X-ND-Authorization", auth)
                    .json(&body),
            )
            .send()
            .await
        }
    })
    .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// PUT `/api/playlist/{id}` — update playlist (supports smart rules payload).
// NOT specta-collected: serde_json::Value in the command signature — specta rc.25 can't export it. Stays hand-written on generate_handler!.
#[tauri::command]
pub async fn nd_update_playlist(
    http_registry: State<'_, Arc<ServerHttpRegistry>>,
    server_url: String,
    token: String,
    id: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let reg = http_registry.as_ref();
    let url = format!("{}/api/playlist/{}", server_url, id);
    let auth = format!("Bearer {}", token);
    let resp = nd_retry(|| {
        let url = url.clone();
        let auth = auth.clone();
        let body = body.clone();
        async move {
            nd_apply_request(
                Some(reg),
                None,
                &url,
                nd_http_client()
                    .put(&url)
                    .header("X-ND-Authorization", auth)
                    .json(&body),
            )
            .send()
            .await
        }
    })
    .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null))
}

/// GET `/api/playlist/{id}` — get a single playlist (includes smart rules if available).
// NOT specta-collected: serde_json::Value in the command signature — specta rc.25 can't export it. Stays hand-written on generate_handler!.
#[tauri::command]
pub async fn nd_get_playlist(
    http_registry: State<'_, Arc<ServerHttpRegistry>>,
    server_url: String,
    token: String,
    id: String,
) -> Result<serde_json::Value, String> {
    let reg = http_registry.as_ref();
    let url = format!("{}/api/playlist/{}", server_url, id);
    let auth = format!("Bearer {}", token);
    let resp = nd_retry(|| {
        let url = url.clone();
        let auth = auth.clone();
        async move {
            nd_apply_request(
                Some(reg),
                None,
                &url,
                nd_http_client()
                    .get(&url)
                    .header("X-ND-Authorization", auth),
            )
            .send()
            .await
        }
    })
    .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null))
}

/// GET `/api/playlist/{id}/tracks` — paginated native track list.
// NOT specta-collected: serde_json::Value in the command signature — specta rc.25 can't export it. Stays hand-written on generate_handler!.
#[tauri::command]
pub async fn nd_get_playlist_tracks(
    http_registry: State<'_, Arc<ServerHttpRegistry>>,
    server_url: String,
    token: String,
    id: String,
    start: Option<u32>,
    end: Option<u32>,
) -> Result<serde_json::Value, String> {
    get_playlist_tracks(
        http_registry.as_ref(),
        &server_url,
        &token,
        &id,
        start,
        end,
    )
    .await
}

async fn get_playlist_tracks(
    reg: &ServerHttpRegistry,
    server_url: &str,
    token: &str,
    id: &str,
    start: Option<u32>,
    end: Option<u32>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/api/playlist/{}/tracks", server_url, id);
    let auth = format!("Bearer {}", token);
    let start = start.unwrap_or(0);
    let end = end.unwrap_or(50);
    let resp = nd_retry(|| {
        let url = url.clone();
        let auth = auth.clone();
        async move {
            nd_apply_request(
                Some(reg),
                None,
                &url,
                nd_http_client()
                    .get(&url)
                    .header("X-ND-Authorization", auth)
                    .query(&[("_start", start), ("_end", end)]),
            )
            .send()
            .await
        }
    })
    .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null))
}

/// Evaluate rules by creating a temporary playlist, reading its first page of
/// tracks (`_start=0` refreshes smart playlists), then deleting it.
// NOT specta-collected: serde_json::Value in the command signature — specta rc.25 can't export it. Stays hand-written on generate_handler!.
#[tauri::command]
pub async fn nd_preview_playlist(
    http_registry: State<'_, Arc<ServerHttpRegistry>>,
    server_url: String,
    token: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    preview_playlist(http_registry.as_ref(), &server_url, &token, body).await
}

async fn preview_playlist(
    reg: &ServerHttpRegistry,
    server_url: &str,
    token: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let created = create_playlist(reg, server_url, token, body).await?;
    let id = created
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    if id.is_empty() {
        return Err("Preview playlist was created without an id".into());
    }
    let tracks = get_playlist_tracks(reg, server_url, token, &id, Some(0), Some(50)).await;
    let cleanup = delete_playlist(reg, server_url, token, &id).await;
    match (tracks, cleanup) {
        (Ok(tracks), Ok(())) => Ok(tracks),
        (Err(read_err), Ok(())) => Err(read_err),
        (Ok(_), Err(cleanup_err)) => Err(format!(
            "Failed to delete preview playlist {id}: {cleanup_err}"
        )),
        (Err(read_err), Err(cleanup_err)) => Err(format!(
            "{read_err}; also failed to delete preview playlist {id}: {cleanup_err}"
        )),
    }
}

/// DELETE `/api/playlist/{id}` — delete playlist.
#[tauri::command]
#[specta::specta]
pub async fn nd_delete_playlist(
    http_registry: State<'_, Arc<ServerHttpRegistry>>,
    server_url: String,
    token: String,
    id: String,
) -> Result<(), String> {
    delete_playlist(http_registry.as_ref(), &server_url, &token, &id).await
}

async fn delete_playlist(
    reg: &ServerHttpRegistry,
    server_url: &str,
    token: &str,
    id: &str,
) -> Result<(), String> {
    let url = format!("{}/api/playlist/{}", server_url, id);
    let auth = format!("Bearer {}", token);
    let resp = nd_retry(|| {
        let url = url.clone();
        let auth = auth.clone();
        async move {
            nd_apply_request(
                Some(reg),
                None,
                &url,
                nd_http_client()
                    .delete(&url)
                    .header("X-ND-Authorization", auth),
            )
            .send()
            .await
        }
    })
    .await?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, text));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path as wm_path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn mount_preview_create(server: &MockServer) {
        Mock::given(method("POST"))
            .and(wm_path("/api/playlist"))
            .and(header("X-ND-Authorization", "Bearer test-token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "preview-1"
            })))
            .expect(1)
            .mount(server)
            .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn preview_surfaces_delete_failure_after_successful_read() {
        let server = MockServer::start().await;
        mount_preview_create(&server).await;
        Mock::given(method("GET"))
            .and(wm_path("/api/playlist/preview-1/tracks"))
            .and(query_param("_start", "0"))
            .and(query_param("_end", "50"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": []
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("DELETE"))
            .and(wm_path("/api/playlist/preview-1"))
            .respond_with(ResponseTemplate::new(500).set_body_string("delete failed"))
            .expect(1)
            .mount(&server)
            .await;

        let registry = ServerHttpRegistry::new();
        let err = preview_playlist(
            &registry,
            &server.uri(),
            "test-token",
            serde_json::json!({ "name": "preview" }),
        )
        .await
        .expect_err("failed cleanup must fail the preview");

        assert_eq!(
            err,
            "Failed to delete preview playlist preview-1: HTTP 500 Internal Server Error: delete failed"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn preview_combines_read_and_delete_failures() {
        let server = MockServer::start().await;
        mount_preview_create(&server).await;
        Mock::given(method("GET"))
            .and(wm_path("/api/playlist/preview-1/tracks"))
            .respond_with(ResponseTemplate::new(502).set_body_string("read failed"))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("DELETE"))
            .and(wm_path("/api/playlist/preview-1"))
            .respond_with(ResponseTemplate::new(503).set_body_string("delete failed"))
            .expect(1)
            .mount(&server)
            .await;

        let registry = ServerHttpRegistry::new();
        let err = preview_playlist(
            &registry,
            &server.uri(),
            "test-token",
            serde_json::json!({ "name": "preview" }),
        )
        .await
        .expect_err("both failures must be reported");

        assert_eq!(
            err,
            "HTTP 502 Bad Gateway: read failed; also failed to delete preview playlist preview-1: HTTP 503 Service Unavailable: delete failed"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn preview_preserves_read_error_when_cleanup_succeeds() {
        let server = MockServer::start().await;
        mount_preview_create(&server).await;
        Mock::given(method("GET"))
            .and(wm_path("/api/playlist/preview-1/tracks"))
            .respond_with(ResponseTemplate::new(502).set_body_string("read failed"))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("DELETE"))
            .and(wm_path("/api/playlist/preview-1"))
            .respond_with(ResponseTemplate::new(204))
            .expect(1)
            .mount(&server)
            .await;

        let registry = ServerHttpRegistry::new();
        let err = preview_playlist(
            &registry,
            &server.uri(),
            "test-token",
            serde_json::json!({ "name": "preview" }),
        )
        .await
        .expect_err("read failure must remain the preview error");

        assert_eq!(err, "HTTP 502 Bad Gateway: read failed");
    }
}
