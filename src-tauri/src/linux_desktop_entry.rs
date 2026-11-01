//! Shared desktop-file identity for Linux media controls and notifications.
//! This is case-sensitive and is not the Tauri application identifier.

pub(crate) fn for_app(product_name: Option<&str>) -> String {
    let flatpak_id = std::env::var("FLATPAK_ID").ok();
    select_desktop_entry(
        flatpak_id.as_deref(),
        option_env!("PSYSONIC_DESKTOP_ENTRY"),
        product_name,
    )
    .to_owned()
}

fn select_desktop_entry<'a>(
    flatpak_id: Option<&'a str>,
    packaged_id: Option<&'a str>,
    product_name: Option<&'a str>,
) -> &'a str {
    // Flatpak exports its own desktop filename, even for a Nix-built binary.
    // Nix installs psysonic.desktop; Tauri deb/rpm use the product name.
    flatpak_id
        .filter(|id| !id.is_empty())
        .or(packaged_id.filter(|id| !id.is_empty()))
        .or(product_name.filter(|id| !id.is_empty()))
        .unwrap_or("Psysonic")
}

#[cfg(test)]
mod tests {
    use super::select_desktop_entry;

    #[test]
    fn tauri_packages_use_case_sensitive_product_name() {
        assert_eq!(
            select_desktop_entry(None, None, Some("Psysonic")),
            "Psysonic"
        );
        assert_eq!(
            select_desktop_entry(None, None, Some("CustomPlayer")),
            "CustomPlayer"
        );
    }

    #[test]
    fn nix_uses_its_installed_lowercase_filename() {
        assert_eq!(
            select_desktop_entry(None, Some("psysonic"), Some("Psysonic")),
            "psysonic"
        );
    }

    #[test]
    fn flatpak_takes_precedence_over_build_and_product_names() {
        assert_eq!(
            select_desktop_entry(
                Some("io.github.psysonic.psysonic"),
                Some("psysonic"),
                Some("Psysonic"),
            ),
            "io.github.psysonic.psysonic"
        );
    }

    #[test]
    fn absent_or_empty_ids_fall_through_without_environment_mutation() {
        assert_eq!(select_desktop_entry(None, None, None), "Psysonic");
        assert_eq!(
            select_desktop_entry(Some(""), Some(""), Some("")),
            "Psysonic"
        );
        assert_eq!(
            select_desktop_entry(Some(""), Some("psysonic"), None),
            "psysonic"
        );
        assert_eq!(
            select_desktop_entry(Some(""), Some(""), Some("Psysonic")),
            "Psysonic"
        );
    }
}
