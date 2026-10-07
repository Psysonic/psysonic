#[cfg(not(debug_assertions))]
use tauri::Emitter;

use crate::{MprisControls, ShortcutMap};

#[tauri::command]
#[specta::specta]
pub(crate) fn register_global_shortcut(
    app: tauri::AppHandle,
    shortcut_map: tauri::State<ShortcutMap>,
    shortcut: String,
    action: String,
) -> Result<(), String> {
    // Debug builds run alongside release with shared settings — do not grab OS shortcuts.
    #[cfg(debug_assertions)]
    {
        let _ = (app, shortcut_map, shortcut, action);
        Ok(())
    }

    #[cfg(not(debug_assertions))]
    {
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

        let mut map = shortcut_map.lock().unwrap();

        // Idempotent: if this exact shortcut+action is already registered, skip.
        // This prevents on_shortcut() from accumulating duplicate handlers when
        // registerAll() is called again after a JS HMR reload or StrictMode double-effect.
        if map.get(&shortcut).map(|a| a == &action).unwrap_or(false) {
            return Ok(());
        }

        // Unregister any existing OS grab for this shortcut before re-registering.
        if let Ok(s) = shortcut.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(s);
        }
        map.insert(shortcut.clone(), action.clone());
        drop(map); // release lock before the blocking OS call

        let parsed: Shortcut = shortcut
            .parse()
            .map_err(|_| format!("Invalid shortcut: {shortcut}"))?;
        app.global_shortcut()
            .on_shortcut(parsed, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = app.emit("shortcut:global-action", action.clone());
                }
            })
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) fn unregister_global_shortcut(
    app: tauri::AppHandle,
    shortcut_map: tauri::State<ShortcutMap>,
    shortcut: String,
) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let _ = (app, shortcut_map, shortcut);
        Ok(())
    }

    #[cfg(not(debug_assertions))]
    {
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
        shortcut_map.lock().unwrap().remove(&shortcut);
        let parsed: Shortcut = shortcut
            .parse()
            .map_err(|_| format!("Invalid shortcut: {shortcut}"))?;
        app.global_shortcut()
            .unregister(parsed)
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) fn mpris_set_metadata(
    controls: tauri::State<MprisControls>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    cover_url: Option<String>,
    duration_secs: Option<f64>,
) -> Result<(), String> {
    use souvlaki::MediaMetadata;
    use std::time::Duration;

    let duration = duration_secs.map(Duration::from_secs_f64);
    let mut guard = controls.lock().unwrap();
    let Some(ctrl) = guard.as_mut() else {
        return Ok(());
    };

    // #1102: Windows SMTC cannot render our cached WebP covers. souvlaki loads
    // the file and SetThumbnail/set_metadata succeed, but the lock screen and
    // Quick-Settings media tile show a blank cover (the OS thumbnail decoder
    // does not handle WebP, even with the Store WebP extension installed).
    // Transcode local WebP covers to PNG for the OS media controls; macOS
    // (ImageIO) decodes WebP fine, so other platforms pass through unchanged.
    let cover_url = smtc_cover_url(cover_url);

    ctrl.set_metadata(MediaMetadata {
        title: title.as_deref(),
        artist: artist.as_deref(),
        album: album.as_deref(),
        cover_url: cover_url.as_deref(),
        duration,
    })
    .map_err(|e| format!("MPRIS set_metadata failed: {e:?}"))
}

/// Rewrite a cached WebP cover URL to a PNG the OS media controls can render.
/// Windows SMTC cannot decode WebP thumbnails (#1102); other platforms and any
/// non-`file://`/non-WebP URL pass through unchanged.
fn smtc_cover_url(cover_url: Option<String>) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(url) = cover_url.as_deref() {
            if let Some(path) = url.strip_prefix("file://") {
                let is_webp = std::path::Path::new(path)
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("webp"));
                if is_webp {
                    match webp_file_to_temp_png(path, "psysonic-smtc-cover.png") {
                        Ok(png) => return Some(format!("file://{png}")),
                        Err(e) => {
                            crate::app_eprintln!("[mpris] cover WebP->PNG transcode failed: {e}")
                        }
                    }
                }
            }
        }
    }
    cover_url
}

/// Decode a WebP file (libwebp, the same codec that wrote the cover cache) and
/// re-encode it as a PNG named `file_name` in the temp dir, returning the native
/// path. Each caller owns its own file name: souvlaki reads its file inside
/// `set_metadata`, while a notification reads its file later.
fn webp_file_to_temp_png(webp_path: &str, file_name: &str) -> Result<String, String> {
    let bytes = std::fs::read(webp_path).map_err(|e| e.to_string())?;
    let decoded = webp::Decoder::new(&bytes)
        .decode()
        .ok_or_else(|| "WebP decode returned None".to_string())?;
    let img = decoded.to_image();
    let out = std::env::temp_dir().join(file_name);
    img.save_with_format(&out, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().into_owned())
}

/// Desktop notification for a track change. It is skipped while a Psysonic
/// window has focus: the user is looking at the player then. Returns whether a
/// notification was shown.
#[tauri::command]
#[specta::specta]
pub(crate) fn show_track_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    cover_path: Option<String>,
) -> Result<bool, String> {
    use tauri::Manager;

    let window_focused = app
        .webview_windows()
        .values()
        .any(|window| window.is_focused().unwrap_or(false));
    if window_focused {
        return Ok(false);
    }

    let image = cover_path.as_deref().and_then(|path| {
        let root = crate::cover_cache::cover_cache_root(&app).ok()?;
        notification_icon(&root, path)
    });

    show_desktop_notification(&app, title, body, image)?;
    Ok(true)
}

/// Windows: the cover as the small square beside the text (`appLogoOverride`),
/// which notify-rust does not expose — it only knows the large inline image.
/// Silent, like every notify-rust toast without a sound name: a chime over the
/// music would be the opposite of helpful.
#[cfg(target_os = "windows")]
fn show_desktop_notification(
    app: &tauri::AppHandle,
    title: String,
    body: String,
    image: Option<String>,
) -> Result<(), String> {
    use tauri_winrt_notification::{IconCrop, Toast};

    // Same rule as tauri-plugin-notification: the AppUserModelID only for the
    // installed app, whose Start-menu shortcut registers it; a build running
    // from `target/` falls back to the PowerShell sender.
    let exe = tauri::utils::platform::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe
        .parent()
        .map(|dir| dir.display().to_string())
        .unwrap_or_default();
    let sep = std::path::MAIN_SEPARATOR;
    let from_target = exe_dir.ends_with(&format!("{sep}target{sep}debug"))
        || exe_dir.ends_with(&format!("{sep}target{sep}release"));
    let app_id = if from_target {
        Toast::POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    };
    let (line1, line2) = body.split_once('\n').unwrap_or((body.as_str(), ""));
    let (line1, line2) = (line1.to_string(), line2.to_string());

    tauri::async_runtime::spawn_blocking(move || {
        let mut toast = Toast::new(&app_id)
            .title(&title)
            .text1(&line1)
            .text2(&line2)
            .sound(None);
        if let Some(image) = image.as_deref() {
            toast = toast.icon(std::path::Path::new(image), IconCrop::Square, "");
        }
        if let Err(e) = toast.show() {
            crate::app_eprintln!("[notification] show failed: {e:?}");
        }
    });
    Ok(())
}

/// Linux and macOS through notify-rust. The cover goes in as `image_path`
/// (Linux `image-path` hint, macOS content image), the slot meant for a
/// picture; tauri-plugin-notification would only forward an `icon`.
#[cfg(not(target_os = "windows"))]
fn show_desktop_notification(
    app: &tauri::AppHandle,
    title: String,
    body: String,
    image: Option<String>,
) -> Result<(), String> {
    let mut notification = notify_rust::Notification::new();
    notification.summary(&title).body(&body);
    if let Some(image) = image.as_deref() {
        notification.image_path(image);
    }
    #[cfg(not(target_os = "macos"))]
    notification.auto_icon();
    #[cfg(target_os = "macos")]
    {
        let _ = notify_rust::set_application(if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            &app.config().identifier
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    // Showing blocks on D-Bus; keep it off the command thread.
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = notification.show() {
            crate::app_eprintln!("[notification] show failed: {e}");
        }
    });
    Ok(())
}

/// The notification image for a cached cover, or `None` when the path does not
/// resolve to a file inside the cover cache. Windows toasts and Linux
/// notification daemons do not reliably read WebP, so cached WebP covers are
/// re-encoded as PNG. The notification is shown from a background thread and
/// reads the image after the command returns, so two files alternate and
/// the next track never overwrites the image the previous one is still loading.
fn notification_icon(cover_root: &std::path::Path, cover_path: &str) -> Option<String> {
    static NOTIFICATION_COVER_SLOT: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);

    let path = cover_path_within(cover_root, std::path::Path::new(cover_path))?;
    let is_webp = path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("webp"));
    if !is_webp {
        // The path as sent, not the canonical one: on Windows that carries a
        // `\\?\` prefix, and toast image sources must not be UNC paths.
        return Some(cover_path.to_string());
    }
    let file_name = next_notification_cover_name(&NOTIFICATION_COVER_SLOT);
    match webp_file_to_temp_png(&path.to_string_lossy(), file_name) {
        Ok(png) => Some(png),
        Err(e) => {
            crate::app_eprintln!("[notification] cover WebP->PNG transcode failed: {e}");
            None
        }
    }
}

fn next_notification_cover_name(slot: &std::sync::atomic::AtomicBool) -> &'static str {
    if slot.fetch_xor(true, std::sync::atomic::Ordering::Relaxed) {
        "psysonic-notification-cover-b.png"
    } else {
        "psysonic-notification-cover-a.png"
    }
}

/// `candidate` resolved through symlinks and `..`, or `None` when it is not an
/// existing file inside `root`. The frontend sends this path, so it must not
/// turn the command into a reader for arbitrary files.
fn cover_path_within(
    root: &std::path::Path,
    candidate: &std::path::Path,
) -> Option<std::path::PathBuf> {
    let root = root.canonicalize().ok()?;
    let path = candidate.canonicalize().ok()?;
    (path.starts_with(&root) && path.is_file()).then_some(path)
}

#[tauri::command]
#[specta::specta]
pub(crate) fn mpris_set_playback(
    controls: tauri::State<MprisControls>,
    playing: bool,
    position_secs: Option<f64>,
) -> Result<(), String> {
    use souvlaki::{MediaPlayback, MediaPosition};
    use std::time::Duration;

    let progress = position_secs.map(|s| MediaPosition(Duration::from_secs_f64(s)));
    let playback = if playing {
        MediaPlayback::Playing { progress }
    } else {
        MediaPlayback::Paused { progress }
    };
    let mut guard = controls.lock().unwrap();
    let Some(ctrl) = guard.as_mut() else {
        return Ok(());
    };
    ctrl.set_playback(playback)
        .map_err(|e| format!("MPRIS set_playback failed: {e:?}"))
}

#[tauri::command]
#[specta::specta]
pub(crate) fn mpris_set_volume(
    controls: tauri::State<MprisControls>,
    volume: f64,
) -> Result<(), String> {
    let volume = crate::normalize_mpris_volume(volume)
        .ok_or_else(|| "MPRIS volume must be finite".to_string())?;

    #[cfg(target_os = "linux")]
    {
        let mut guard = controls.lock().unwrap();
        let Some(ctrl) = guard.as_mut() else {
            return Ok(());
        };
        ctrl.set_volume(volume)
            .map_err(|e| format!("MPRIS set_volume failed: {e:?}"))
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (controls, volume);
        Ok(())
    }
}

/// Returns true if `path` is an accessible directory (used for pre-flight checks in the frontend).
#[tauri::command]
#[specta::specta]
pub(crate) fn check_dir_accessible(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fresh_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "psysonic-notification-test-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_webp(path: &std::path::Path) {
        let pixels = vec![200u8; 4 * 4 * 4];
        let encoded = webp::Encoder::from_rgba(&pixels, 4, 4).encode(80.0);
        std::fs::write(path, &*encoded).unwrap();
    }

    #[test]
    fn cover_path_within_accepts_only_files_inside_the_cache() {
        let root = fresh_dir("within-root");
        let album = root.join("server").join("al-1");
        std::fs::create_dir_all(&album).unwrap();
        let cover = album.join("256.webp");
        std::fs::write(&cover, b"cover").unwrap();
        let outside = fresh_dir("within-outside");
        let foreign = outside.join("foreign.png");
        std::fs::write(&foreign, b"foreign").unwrap();
        let escaping = album
            .join("..")
            .join("..")
            .join("..")
            .join(outside.file_name().unwrap())
            .join("foreign.png");

        assert!(cover_path_within(&root, &cover).is_some());
        assert!(cover_path_within(&root, &foreign).is_none());
        assert!(cover_path_within(&root, &escaping).is_none());
        assert!(
            cover_path_within(&root, &album).is_none(),
            "a directory is no cover"
        );
        assert!(cover_path_within(&root, &root.join("missing.webp")).is_none());
    }

    #[test]
    fn notification_icon_reencodes_a_cached_webp_cover_as_png() {
        let root = fresh_dir("icon-webp");
        let cover = root.join("256.webp");
        write_webp(&cover);

        let icon = notification_icon(&root, &cover.to_string_lossy()).unwrap();

        assert!(icon.ends_with(".png"), "got {icon}");
        let decoded = image::open(&icon).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (4, 4));
    }

    #[test]
    fn notification_icon_passes_other_cached_formats_through_as_sent() {
        let root = fresh_dir("icon-png");
        let cover = root.join("cover.png");
        std::fs::write(&cover, b"png").unwrap();
        let sent = cover.to_string_lossy().into_owned();

        let icon = notification_icon(&root, &sent).unwrap();

        // Not the canonical form: on Windows that is a `\\?\` path, which a
        // toast does not accept as an image source.
        assert_eq!(icon, sent);
        assert!(!icon.starts_with(r"\\?\"));
    }

    #[test]
    fn notification_icon_rejects_a_path_outside_the_cache() {
        let root = fresh_dir("icon-root");
        let outside = fresh_dir("icon-outside");
        let foreign = outside.join("foreign.webp");
        write_webp(&foreign);

        assert_eq!(notification_icon(&root, &foreign.to_string_lossy()), None);
    }

    #[test]
    fn consecutive_notifications_alternate_their_image_file() {
        let slot = std::sync::atomic::AtomicBool::new(false);
        let first = next_notification_cover_name(&slot);
        let second = next_notification_cover_name(&slot);
        let third = next_notification_cover_name(&slot);

        assert_ne!(first, second);
        assert_eq!(first, third);
    }
}
