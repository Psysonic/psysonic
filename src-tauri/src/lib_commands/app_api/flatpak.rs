#[cfg(target_os = "linux")]
use std::time::Duration;

#[cfg(target_os = "linux")]
const FLATPAK_INFO_PATH: &str = "/.flatpak-info";
#[cfg(target_os = "linux")]
const FLATPAK_REPOSITORY_BASE_URL: &str = "https://flatpak.psysonic.de";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlatpakUpdateInfo {
    pub branch: String,
    pub version: String,
    pub tag: String,
    pub body: String,
}

#[cfg(target_os = "linux")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishedFlatpakRelease {
    channel: String,
    version: String,
    tag: String,
    body: String,
}

#[cfg(any(target_os = "linux", test))]
fn flatpak_branch_from_info(contents: &str) -> Option<String> {
    let mut in_instance_section = false;
    for line in contents.lines().map(str::trim) {
        if line.starts_with('[') && line.ends_with(']') {
            in_instance_section = line == "[Instance]";
            continue;
        }
        if in_instance_section {
            if let Some(branch) = line.strip_prefix("branch=") {
                return matches!(branch, "stable" | "rc").then(|| branch.to_string());
            }
        }
    }
    None
}

#[cfg(any(target_os = "linux", test))]
fn flatpak_version_is_valid(version: &str, branch: &str) -> bool {
    let (base, suffix) = version
        .split_once('-')
        .map_or((version, None), |(base, suffix)| (base, Some(suffix)));
    let mut parts = base.split('.');
    let base_is_valid = parts.clone().count() == 3
        && parts.all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()));
    if !base_is_valid {
        return false;
    }
    match suffix {
        None => true,
        Some(rc) if branch == "rc" => rc.strip_prefix("rc.").is_some_and(|number| {
            !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
        }),
        Some(_) => false,
    }
}

/// Return update metadata from the repository backing the current Flatpak branch.
#[tauri::command]
#[specta::specta]
pub(crate) async fn flatpak_update_info() -> Option<FlatpakUpdateInfo> {
    #[cfg(target_os = "linux")]
    {
        let info = std::fs::read_to_string(FLATPAK_INFO_PATH).ok()?;
        let branch = flatpak_branch_from_info(&info)?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .user_agent(format!("Psysonic/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .ok()?;
        let release = client
            .get(format!(
                "{FLATPAK_REPOSITORY_BASE_URL}/{branch}/release.json"
            ))
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?
            .json::<PublishedFlatpakRelease>()
            .await
            .ok()?;
        if release.channel != branch
            || release.tag != format!("app-v{}", release.version)
            || !flatpak_version_is_valid(&release.version, &branch)
        {
            return None;
        }
        Some(FlatpakUpdateInfo {
            branch,
            version: release.version,
            tag: release.tag,
            body: release.body,
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{flatpak_branch_from_info, flatpak_version_is_valid};

    #[test]
    fn reads_supported_branch_from_flatpak_instance_section() {
        let stable = "[Application]\nname=io.github.psysonic.psysonic\n\n[Instance]\ninstance-id=1\nbranch=stable\narch=x86_64\n";
        let rc = "[Instance]\ninstance-id=2\nbranch=rc\n";

        assert_eq!(flatpak_branch_from_info(stable).as_deref(), Some("stable"));
        assert_eq!(flatpak_branch_from_info(rc).as_deref(), Some("rc"));
    }

    #[test]
    fn ignores_unknown_or_out_of_section_flatpak_branches() {
        assert_eq!(flatpak_branch_from_info("[Application]\nbranch=rc\n"), None);
        assert_eq!(flatpak_branch_from_info("[Instance]\nbranch=beta\n"), None);
    }

    #[test]
    fn validates_versions_allowed_on_each_channel() {
        assert!(flatpak_version_is_valid("1.53.0", "stable"));
        assert!(!flatpak_version_is_valid("1.53.0-rc.1", "stable"));
        assert!(flatpak_version_is_valid("1.53.0", "rc"));
        assert!(flatpak_version_is_valid("1.54.0-rc.2", "rc"));
        assert!(!flatpak_version_is_valid("1.54-rc.2", "rc"));
        assert!(!flatpak_version_is_valid("latest", "rc"));
    }
}
