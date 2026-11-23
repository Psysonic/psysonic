use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use super::AudioEngine;

pub(crate) fn audio_http_client(state: &AudioEngine) -> reqwest::Client {
    state
        .http_client
        .read()
        .map(|c| c.clone())
        .unwrap_or_default()
}

/// Builder for the playback HTTP clients. Audio is already compressed, and a
/// proxy that compresses it anyway drops `Content-Length` and `Accept-Ranges`,
/// which sends playback to the non-seekable stream reader.
pub(crate) fn audio_http_client_builder(ua: &str) -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .use_rustls_tls()
        .user_agent(ua)
        .no_gzip()
        .no_brotli()
}

pub fn refresh_http_user_agent(state: &AudioEngine, ua: &str) {
    let client = audio_http_client_builder(ua).build().unwrap_or_default();
    if let Ok(mut slot) = state.http_client.write() {
        *slot = client;
    }
}

pub(crate) fn apply_playback_request_headers(
    registry: Option<&psysonic_core::server_http::ServerHttpRegistry>,
    server_id: Option<&str>,
    url: &str,
    req: reqwest::RequestBuilder,
) -> reqwest::RequestBuilder {
    psysonic_core::server_http::apply_optional_registry_headers(registry, server_id, url, req)
}

/// Custom HTTP headers for reverse-proxy gates — cloned into background download tasks.
#[derive(Clone, Default)]
pub(crate) struct PlaybackHttpHeaders {
    registry: Option<Arc<psysonic_core::server_http::ServerHttpRegistry>>,
    server_id: Option<String>,
}

impl PlaybackHttpHeaders {
    pub fn from_app(app: &tauri::AppHandle, server_id: Option<&str>) -> Self {
        Self {
            registry: app
                .try_state::<Arc<psysonic_core::server_http::ServerHttpRegistry>>()
                .map(|s| Arc::clone(&*s)),
            server_id: server_id.filter(|s| !s.is_empty()).map(str::to_string),
        }
    }

    pub fn apply(&self, url: &str, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        apply_playback_request_headers(
            self.registry.as_deref(),
            self.server_id.as_deref(),
            url,
            req,
        )
    }
}

pub(crate) fn scoped_http_get(
    state: &AudioEngine,
    registry: Option<&psysonic_core::server_http::ServerHttpRegistry>,
    server_id: Option<&str>,
    url: &str,
) -> reqwest::RequestBuilder {
    apply_playback_request_headers(registry, server_id, url, audio_http_client(state).get(url))
}

/// Resolve registry + server id for playback/preload HTTP GETs.
pub(crate) fn playback_scoped_get(
    state: &AudioEngine,
    app: &tauri::AppHandle,
    url: &str,
    server_id: Option<&str>,
) -> reqwest::RequestBuilder {
    let registry = app
        .try_state::<Arc<psysonic_core::server_http::ServerHttpRegistry>>()
        .map(|s| Arc::clone(&*s));
    let sid = server_id
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| state.current_playback_server_id.lock().unwrap().clone());
    scoped_http_get(state, registry.as_deref(), sid.as_deref(), url)
}

#[cfg(test)]
mod tests {
    use super::audio_http_client_builder;
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn audio_client_does_not_offer_content_coding() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;

        let client = audio_http_client_builder("psysonic-test").build().unwrap();
        client.get(server.uri()).send().await.unwrap();

        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].headers.get("accept-encoding").is_none());
    }
}
