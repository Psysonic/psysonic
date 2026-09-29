use super::super::*;
use psysonic_core::server_http::{
    CustomHeaderEntryWire, CustomHeadersApplyTo, EndpointKind, ServerHttpContextSyncWire,
    ServerHttpEndpointWire, ServerHttpRegistry,
};
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn registry_for(endpoint: &str, supports_raw_stream: bool) -> ServerHttpRegistry {
    let registry = ServerHttpRegistry::new();
    registry.sync(ServerHttpContextSyncWire {
        server_id: "server-key".into(),
        app_server_id: "profile-id".into(),
        endpoints: vec![ServerHttpEndpointWire {
            url: endpoint.into(),
            kind: EndpointKind::Public,
        }],
        custom_headers: vec![CustomHeaderEntryWire {
            name: "X-Gate".into(),
            value: "token".into(),
        }],
        custom_headers_apply_to: Some(CustomHeadersApplyTo::Public),
        supports_raw_stream,
    });
    registry
}

#[tokio::test]
async fn first_probe_failure_produces_no_canonical_verdict() {
    // Server-forced transcoding is invisible on the wire: a FIRST-EVER
    // probe failure must not be treated as proof the bytes are original.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/stream.view"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let url = format!("{}/rest/stream.view?id=t1", server.uri());
    let registry = registry_for(&server.uri(), true);
    let got = resolve_trusted_identity(
        &reqwest::Client::new(),
        Some(&registry),
        Some("server-key"),
        &url,
    )
    .await;
    assert_eq!(got, TrustedProbeVerdict::SkipCanonicalWrites);
}

#[tokio::test]
async fn unknown_endpoint_never_issues_an_original_request() {
    let server = MockServer::start().await;
    let url = format!("{}/rest/stream.view?id=t1", server.uri());

    let unknown =
        resolve_trusted_identity(&reqwest::Client::new(), None, Some("server-key"), &url).await;

    assert_eq!(unknown, TrustedProbeVerdict::SkipCanonicalWrites);
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn registered_non_navidrome_uses_standard_original_download() {
    let server = MockServer::start().await;
    let body = vec![0x61; 16 * 1024];
    Mock::given(method("GET"))
        .and(path("/rest/download.view"))
        .and(query_param("id", "t1"))
        .and(header("Range", "bytes=0-16383"))
        .and(header("X-Gate", "token"))
        .respond_with(
            ResponseTemplate::new(206)
                .insert_header("Content-Range", "bytes 0-16383/9999999")
                .set_body_bytes(body.clone()),
        )
        .mount(&server)
        .await;
    let url = format!("{}/rest/stream.view?id=t1&maxBitRate=128", server.uri());
    let registry = registry_for(&server.uri(), false);
    let verdict = resolve_trusted_identity(
        &reqwest::Client::new(),
        Some(&registry),
        Some("server-key"),
        &url,
    )
    .await;

    assert_eq!(
        verdict,
        TrustedProbeVerdict::Trusted(crate::analysis_cache::md5_first_16kb(&body))
    );
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].url.path(), "/rest/download.view");
    assert!(requests[0]
        .url
        .query()
        .is_some_and(|query| !query.contains("format=raw")));
}

#[tokio::test]
async fn navidrome_raw_failure_does_not_fall_back_to_download() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/stream.view"))
        .and(query_param("format", "raw"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/rest/download.view"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![0x61; 16 * 1024]))
        .mount(&server)
        .await;
    let url = format!("{}/rest/stream.view?id=t1", server.uri());
    let registry = registry_for(&server.uri(), true);

    let verdict = resolve_trusted_identity(
        &reqwest::Client::new(),
        Some(&registry),
        Some("server-key"),
        &url,
    )
    .await;

    assert_eq!(verdict, TrustedProbeVerdict::SkipCanonicalWrites);
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].url.path(), "/rest/stream.view");
}

#[test]
fn verified_raw_request_requires_capability_endpoint_and_exact_raw_value() {
    let registry = ServerHttpRegistry::new();
    registry.sync(ServerHttpContextSyncWire {
        server_id: "server-key".into(),
        app_server_id: "profile-id".into(),
        endpoints: vec![ServerHttpEndpointWire {
            url: "https://s.example".into(),
            kind: EndpointKind::Public,
        }],
        custom_headers: Vec::new(),
        custom_headers_apply_to: None,
        supports_raw_stream: true,
    });

    assert!(is_verified_raw_stream_request(
        Some(&registry),
        Some("server-key"),
        "https://s.example/rest/stream.view?id=t1&format=raw",
    ));
    assert!(!is_verified_raw_stream_request(
        Some(&registry),
        Some("server-key"),
        "https://s.example/rest/stream.view?id=t1&format=RAW",
    ));
    assert!(!is_verified_raw_stream_request(
        Some(&registry),
        Some("server-key"),
        "https://other.example/rest/stream.view?id=t1&format=raw",
    ));
    assert!(!is_verified_raw_stream_request(
        Some(&registry),
        Some("server-key"),
        "https://s.example/rest/stream?id=t1&format=raw",
    ));
    assert!(!is_verified_raw_stream_request(
        Some(&registry),
        Some("server-key"),
        "https://s.example/rest/stream.view?id=t1&format=raw&maxBitRate=64",
    ));
}

#[test]
fn verified_original_request_uses_raw_or_download_by_capability() {
    let raw_registry = registry_for("https://raw.example", true);
    assert!(is_verified_original_request(
        Some(&raw_registry),
        Some("server-key"),
        "https://raw.example/rest/stream.view?id=t1&format=raw",
    ));
    assert!(!is_verified_original_request(
        Some(&raw_registry),
        Some("server-key"),
        "https://raw.example/rest/download.view?id=t1",
    ));

    let download_registry = registry_for("https://download.example", false);
    assert!(is_verified_original_request(
        Some(&download_registry),
        Some("server-key"),
        "https://download.example/rest/download.view?id=t1",
    ));
    assert!(!is_verified_original_request(
        Some(&download_registry),
        Some("server-key"),
        "https://download.example/rest/stream.view?id=t1",
    ));
    assert!(!is_verified_original_request(
        Some(&download_registry),
        Some("server-key"),
        "https://download.example/rest/download.view?id=t1&format=mp3",
    ));
    assert!(!is_verified_original_request(
        Some(&download_registry),
        Some("server-key"),
        "https://other.example/rest/download.view?id=t1",
    ));
    assert!(!is_verified_original_request(
        Some(&download_registry),
        Some("server-key"),
        "https://download.example/rest/download?id=t1",
    ));
}
