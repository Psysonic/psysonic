use std::path::Path;

use tokio::io::AsyncReadExt;

pub(super) async fn read_original_prefix(path: &Path) -> std::io::Result<Vec<u8>> {
    let limit = psysonic_analysis::raw_probe::RAW_PROBE_RANGE_END + 1;
    let file = tokio::fs::File::open(path).await?;
    let mut prefix = Vec::with_capacity(limit as usize);
    file.take(limit).read_to_end(&mut prefix).await?;
    Ok(prefix)
}

pub(super) async fn file_matches_trusted_original(
    path: &Path,
    trusted_md5_16kb: &str,
) -> Result<bool, String> {
    let prefix = read_original_prefix(path)
        .await
        .map_err(|error| error.to_string())?;
    Ok(psysonic_analysis::raw_probe::bytes_match_trusted(
        &prefix,
        trusted_md5_16kb,
    ))
}

pub(super) async fn resolve_trusted_original(
    client: &reqwest::Client,
    registry: Option<&psysonic_core::server_http::ServerHttpRegistry>,
    server_ref: Option<&str>,
    url: &str,
) -> Result<String, String> {
    psysonic_analysis::raw_probe::fetch_trusted_original_md5(client, registry, server_ref, url)
        .await
        .ok_or_else(|| "trusted original identity unavailable".to_string())
}
