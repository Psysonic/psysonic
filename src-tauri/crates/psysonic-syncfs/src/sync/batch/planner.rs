use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use super::payload::{device_sync_source_key, playlist_collision_source_keys};
use super::{
    estimate_track_size_bytes, inject_flat_layout, inject_overwrite, inject_playlist_context,
    inject_target_suffix, track_sync_info_from_subsonic_json, DeviceSyncLayoutMode,
    DeviceSyncManifestFile, DeviceSyncManifestPlaylist, DeviceSyncPlannedPlaylist,
    DeviceSyncPlaylistPathMode, DeviceSyncSourceFingerprint, DeviceSyncSourcePayload,
    DeviceSyncTranscode, SyncDeltaResult,
};
use crate::sync::device::{
    build_track_path, planned_path_stays_within, playlist_file_relative_path, read_device_manifest,
    resolve_within_root,
};

mod manifest;
mod retained;

pub(crate) use manifest::portable_path_identity;
use manifest::{
    manifest_layout_mode, manifest_source_keys, old_manifest_files, old_manifest_playlists,
};
use retained::{retained_manifest_files, retained_manifest_playlists};

/// How the device should look: folder layout, playlist references and the
/// format every file is stored in.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct SyncPlanOptions {
    pub layout_mode: DeviceSyncLayoutMode,
    pub playlist_path_mode: DeviceSyncPlaylistPathMode,
    pub transcode: DeviceSyncTranscode,
}

/// An existing device file relocated to its new planned path, e.g. after a
/// playlist reorder renumbered a self-contained copy. Paths are root-relative.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceSyncPlannedMove {
    pub(crate) from: String,
    pub(crate) to: String,
}

#[derive(Clone)]
pub(super) struct FetchedDeviceSyncSource {
    pub source: DeviceSyncSourcePayload,
    pub tracks: Vec<serde_json::Value>,
}

#[derive(Clone)]
struct DesiredFile {
    track_id: String,
    relative_path: String,
    source_keys: BTreeSet<String>,
    size_bytes: u64,
    source: DeviceSyncSourceFingerprint,
    track: serde_json::Value,
    playlist_name: Option<String>,
    playlist_id: Option<String>,
    playlist_index: Option<u32>,
}

struct DesiredState {
    files: BTreeMap<String, DesiredFile>,
    playlists: Vec<DeviceSyncPlannedPlaylist>,
    manifest_playlists: Vec<DeviceSyncManifestPlaylist>,
}

struct DesiredFileInput<'a> {
    key: String,
    source_key: &'a str,
    track_id: &'a str,
    track: &'a serde_json::Value,
    playlist_name: Option<&'a str>,
    playlist_id: Option<&'a str>,
    playlist_index: Option<u32>,
}

fn portable_track_path(track: &crate::sync::device::TrackSyncInfo) -> String {
    format!("{}.{}", build_track_path(track), track.suffix).replace('\\', "/")
}

/// How a shared-track playlist points at its track. The `.m3u8` sits two
/// folders deep (`Playlists/{name}/`), or in the root next to the tracks for
/// the flat layout.
fn playlist_reference(
    relative_path: &str,
    mode: DeviceSyncPlaylistPathMode,
    flat: bool,
    root: &Path,
) -> String {
    match mode {
        DeviceSyncPlaylistPathMode::PlaylistRelative if flat => relative_path.to_string(),
        DeviceSyncPlaylistPathMode::PlaylistRelative => format!("../../{relative_path}"),
        DeviceSyncPlaylistPathMode::DeviceRooted => format!("/{relative_path}"),
        DeviceSyncPlaylistPathMode::Absolute => absolute_reference(root, relative_path),
    }
}

/// Full native path of a device file, for playlists imported by software that
/// only resolves absolute entries.
fn absolute_reference(root: &Path, relative_path: &str) -> String {
    relative_path
        .split('/')
        .fold(root.to_path_buf(), |path, component| path.join(component))
        .to_string_lossy()
        .to_string()
}

/// Leading track number of a self-contained playlist file (`07 - Artist - Title.flac`).
fn playlist_index_from_path(relative_path: &str) -> Option<u32> {
    let name = relative_path.rsplit('/').next()?;
    let digits = name
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>();
    digits.parse().ok().filter(|index| *index > 0)
}

fn file_extension_identity(relative_path: &str) -> Option<String> {
    Path::new(relative_path)
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
}

/// Proves that a manifest file sits exactly where the planner would have put
/// its track for one of its recorded sources, using the server's metadata for
/// that track. A manifest is device data and cannot be trusted to name paths on
/// its own; this admits only paths the planner itself produces for a real
/// song, so a tampered manifest still cannot nominate unrelated files.
fn authenticated_by_server_song(
    file: &DeviceSyncManifestFile,
    songs: &HashMap<&str, &serde_json::Value>,
    sources: &HashMap<String, &DeviceSyncSourcePayload>,
    collision_sources: &HashSet<String>,
    layout_mode: DeviceSyncLayoutMode,
) -> bool {
    let Some(song) = songs.get(file.track_id.as_str()) else {
        return false;
    };
    let identity = portable_path_identity(&file.relative_path);
    let target_suffix = file.effective_transcode().target_suffix();
    file.source_keys.iter().any(|source_key| {
        let Some(source) = sources.get(source_key) else {
            return false;
        };
        let (playlist_name, playlist_id, playlist_index) = if source.source_type == "playlist"
            && layout_mode == DeviceSyncLayoutMode::SelfContained
        {
            let Some(index) = playlist_index_from_path(&file.relative_path) else {
                return false;
            };
            let playlist_id = source.path_id.as_deref().or_else(|| {
                collision_sources
                    .contains(source_key)
                    .then_some(source.id.as_str())
            });
            (
                Some(source.name.as_deref().unwrap_or("")),
                playlist_id,
                Some(index),
            )
        } else {
            (None, None, None)
        };
        let mut sync_info = track_sync_info_from_subsonic_json(
            song,
            &file.track_id,
            playlist_name,
            playlist_id,
            playlist_index,
        );
        sync_info.flat_layout = layout_mode == DeviceSyncLayoutMode::Flat;
        if let Some(suffix) = target_suffix {
            sync_info.suffix = suffix.to_string();
        }
        portable_path_identity(&portable_track_path(&sync_info)) == identity
    })
}

fn physical_key(
    source: &DeviceSyncSourcePayload,
    source_key: &str,
    track_id: &str,
    playlist_index: u32,
    layout_mode: DeviceSyncLayoutMode,
) -> String {
    if source.source_type == "playlist" && layout_mode == DeviceSyncLayoutMode::SelfContained {
        format!("playlist:{source_key}:{playlist_index}:{track_id}")
    } else {
        format!("track:{track_id}")
    }
}

fn add_file(
    files: &mut BTreeMap<String, DesiredFile>,
    paths: &mut HashMap<String, String>,
    input: DesiredFileInput<'_>,
    flat: bool,
    transcode: DeviceSyncTranscode,
) -> Result<String, String> {
    if let Some(existing) = files.get_mut(&input.key) {
        existing.source_keys.insert(input.source_key.to_string());
        return Ok(existing.relative_path.clone());
    }

    let mut sync_info = track_sync_info_from_subsonic_json(
        input.track,
        input.track_id,
        input.playlist_name,
        input.playlist_id,
        input.playlist_index,
    );
    sync_info.flat_layout = flat;
    if let Some(suffix) = transcode.target_suffix() {
        sync_info.suffix = suffix.to_string();
    }
    let relative_path = portable_track_path(&sync_info);
    let path_identity = portable_path_identity(&relative_path);
    if let Some(existing_key) = paths.get(&path_identity) {
        if existing_key != &input.key {
            return Err(format!("DEVICE_SYNC_PATH_COLLISION:{relative_path}"));
        }
    }
    paths.insert(path_identity, input.key.clone());

    let mut source_keys = BTreeSet::new();
    source_keys.insert(input.source_key.to_string());
    files.insert(
        input.key,
        DesiredFile {
            track_id: input.track_id.to_string(),
            relative_path: relative_path.clone(),
            source_keys,
            size_bytes: estimate_track_size_bytes(input.track, transcode),
            source: DeviceSyncSourceFingerprint::from_subsonic_json(input.track),
            track: input.track.clone(),
            playlist_name: input.playlist_name.map(str::to_string),
            playlist_id: input.playlist_id.map(str::to_string),
            playlist_index: input.playlist_index,
        },
    );
    Ok(relative_path)
}

fn build_desired_state(
    fetched: &[FetchedDeviceSyncSource],
    included_source_keys: &HashSet<String>,
    options: SyncPlanOptions,
    root: &Path,
) -> Result<DesiredState, String> {
    let SyncPlanOptions {
        layout_mode,
        playlist_path_mode,
        transcode,
    } = options;
    let included_sources = fetched
        .iter()
        .filter(|entry| included_source_keys.contains(&device_sync_source_key(&entry.source)))
        .map(|entry| entry.source.clone())
        .collect::<Vec<_>>();
    let collision_sources = playlist_collision_source_keys(&included_sources);
    let flat = layout_mode == DeviceSyncLayoutMode::Flat;
    let mut files = BTreeMap::new();
    let mut paths = HashMap::new();

    // Album/artist metadata wins when a shared track is also present in a playlist.
    for entry in fetched.iter().filter(|entry| {
        entry.source.source_type != "playlist"
            && included_source_keys.contains(&device_sync_source_key(&entry.source))
    }) {
        let source_key = device_sync_source_key(&entry.source);
        for track in &entry.tracks {
            let Some(track_id) = track.get("id").and_then(|value| value.as_str()) else {
                continue;
            };
            let key = physical_key(&entry.source, &source_key, track_id, 0, layout_mode);
            add_file(
                &mut files,
                &mut paths,
                DesiredFileInput {
                    key,
                    source_key: &source_key,
                    track_id,
                    track,
                    playlist_name: None,
                    playlist_id: None,
                    playlist_index: None,
                },
                flat,
                transcode,
            )?;
        }
    }

    let mut playlists = Vec::new();
    let mut manifest_playlists = Vec::new();
    for entry in fetched.iter().filter(|entry| {
        entry.source.source_type == "playlist"
            && included_source_keys.contains(&device_sync_source_key(&entry.source))
    }) {
        let source_key = device_sync_source_key(&entry.source);
        let playlist_name = entry.source.name.as_deref().unwrap_or("");
        let playlist_id = entry.source.path_id.as_deref().or_else(|| {
            collision_sources
                .contains(&source_key)
                .then_some(entry.source.id.as_str())
        });
        let relative_playlist_path = playlist_file_relative_path(playlist_name, playlist_id, flat);
        let mut playlist_tracks = Vec::with_capacity(entry.tracks.len());
        let mut references = Vec::with_capacity(entry.tracks.len());

        for (index, track) in entry.tracks.iter().enumerate() {
            let Some(track_id) = track.get("id").and_then(|value| value.as_str()) else {
                continue;
            };
            let playlist_index = (index as u32) + 1;
            let key = physical_key(
                &entry.source,
                &source_key,
                track_id,
                playlist_index,
                layout_mode,
            );
            let (path_name, path_id, path_index) =
                if layout_mode == DeviceSyncLayoutMode::SelfContained {
                    (Some(playlist_name), playlist_id, Some(playlist_index))
                } else {
                    (None, None, None)
                };
            let relative_track_path = add_file(
                &mut files,
                &mut paths,
                DesiredFileInput {
                    key,
                    source_key: &source_key,
                    track_id,
                    track,
                    playlist_name: path_name,
                    playlist_id: path_id,
                    playlist_index: path_index,
                },
                flat,
                transcode,
            )?;
            // Self-contained copies sit next to their playlist file, so a bare
            // filename resolves — unless full paths were asked for.
            let reference = if layout_mode == DeviceSyncLayoutMode::SelfContained
                && playlist_path_mode != DeviceSyncPlaylistPathMode::Absolute
            {
                relative_track_path
                    .rsplit('/')
                    .next()
                    .unwrap_or(&relative_track_path)
                    .to_string()
            } else {
                playlist_reference(&relative_track_path, playlist_path_mode, flat, root)
            };
            let mut playlist_track = track.clone();
            if let Some(suffix) = transcode.target_suffix() {
                inject_target_suffix(&mut playlist_track, suffix);
            }
            playlist_tracks.push(playlist_track);
            references.push(reference);
        }

        playlists.push(DeviceSyncPlannedPlaylist {
            source_key: source_key.clone(),
            name: playlist_name.to_string(),
            path_id: playlist_id.map(str::to_string),
            relative_path: relative_playlist_path.clone(),
            tracks: playlist_tracks,
            references,
        });
        manifest_playlists.push(DeviceSyncManifestPlaylist {
            source_key,
            relative_path: relative_playlist_path,
        });
    }

    Ok(DesiredState {
        files,
        playlists,
        manifest_playlists,
    })
}

fn manifest_files(
    state: &DesiredState,
    transcode: DeviceSyncTranscode,
) -> Vec<DeviceSyncManifestFile> {
    state
        .files
        .values()
        .map(|file| DeviceSyncManifestFile {
            track_id: file.track_id.clone(),
            relative_path: file.relative_path.clone(),
            source_keys: file.source_keys.iter().cloned().collect(),
            size_bytes: file.size_bytes,
            transcode: Some(transcode),
            source: Some(file.source.clone()),
        })
        .collect()
}

/// Whether an existing copy must be fetched again: it was made with another
/// format or bitrate, or the server's source file changed since. Copies from
/// manifests that predate the fingerprint are trusted as current rather than
/// replaced wholesale.
fn copy_is_stale(
    old: &DeviceSyncManifestFile,
    desired: &DesiredFile,
    transcode: DeviceSyncTranscode,
) -> bool {
    old.effective_transcode() != transcode
        || old
            .source
            .as_ref()
            .is_some_and(|source| source != &desired.source)
}

#[cfg(test)]
pub(super) fn build_sync_plan(
    fetched: &[FetchedDeviceSyncSource],
    deletion_ids: &[String],
    target_dir: &str,
    layout_mode: DeviceSyncLayoutMode,
    playlist_path_mode: DeviceSyncPlaylistPathMode,
) -> Result<SyncDeltaResult, String> {
    build_sync_plan_with_resume(
        fetched,
        deletion_ids,
        target_dir,
        SyncPlanOptions {
            layout_mode,
            playlist_path_mode,
            transcode: DeviceSyncTranscode::default(),
        },
        None,
        &HashMap::new(),
    )
}

/// `departed_songs` holds server metadata for tracks the previous manifest
/// recorded that no current source lists any more (see `fetch_departed_songs`).
pub(super) fn build_sync_plan_with_resume(
    fetched: &[FetchedDeviceSyncSource],
    deletion_ids: &[String],
    target_dir: &str,
    options: SyncPlanOptions,
    resume_files: Option<&[DeviceSyncManifestFile]>,
    departed_songs: &HashMap<String, serde_json::Value>,
) -> Result<SyncDeltaResult, String> {
    let SyncPlanOptions {
        layout_mode,
        transcode,
        ..
    } = options;
    let root = Path::new(target_dir);
    let deletion_keys = deletion_ids.iter().cloned().collect::<HashSet<_>>();
    let all_source_keys = fetched
        .iter()
        .map(|entry| device_sync_source_key(&entry.source))
        .collect::<HashSet<_>>();
    let desired_source_keys = all_source_keys
        .difference(&deletion_keys)
        .cloned()
        .collect::<HashSet<_>>();
    let desired = build_desired_state(fetched, &desired_source_keys, options, root)?;

    let previous_manifest = read_device_manifest(target_dir.to_string());
    if let (Some(manifest), Some(owner)) = (
        previous_manifest.as_ref(),
        fetched
            .first()
            .map(|entry| entry.source.server_index_key.as_str()),
    ) {
        if manifest
            .get("ownerServerIndexKey")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|previous_owner| previous_owner != owner)
        {
            return Err("DEVICE_SYNC_SERVER_OWNER_MISMATCH".to_string());
        }
    }
    let previous_source_keys = previous_manifest
        .as_ref()
        .map(manifest_source_keys)
        .filter(|keys| !keys.is_empty())
        .unwrap_or_else(|| all_source_keys.clone());
    let previous_layout_mode = manifest_layout_mode(previous_manifest.as_ref());
    let derived_old = build_desired_state(
        fetched,
        &previous_source_keys,
        SyncPlanOptions {
            layout_mode: previous_layout_mode,
            ..SyncPlanOptions::default()
        },
        root,
    )?;
    let has_materialized_plan = previous_manifest.as_ref().is_some_and(|manifest| {
        manifest.get("files").is_some() && manifest.get("playlists").is_some()
    });
    let derived_old_files = manifest_files(&derived_old, DeviceSyncTranscode::default());
    let previous_sources = fetched
        .iter()
        .map(|entry| (device_sync_source_key(&entry.source), &entry.source))
        .filter(|(key, _)| previous_source_keys.contains(key))
        .collect::<HashMap<_, _>>();
    let previous_collision_sources = playlist_collision_source_keys(
        &previous_sources
            .values()
            .map(|source| (*source).clone())
            .collect::<Vec<_>>(),
    );
    let mut known_songs = departed_songs
        .iter()
        .map(|(id, song)| (id.as_str(), song))
        .collect::<HashMap<_, _>>();
    for entry in fetched {
        for track in &entry.tracks {
            if let Some(id) = track.get("id").and_then(serde_json::Value::as_str) {
                known_songs.insert(id, track);
            }
        }
    }
    let expected_old_files = derived_old_files
        .iter()
        .map(|file| (portable_path_identity(&file.relative_path), file))
        .collect::<HashMap<_, _>>();
    let materialized_old_files = previous_manifest.as_ref().and_then(old_manifest_files);
    let old_files = materialized_old_files
        .clone()
        .map(|files| {
            files
                .into_iter()
                .filter(|file| {
                    let owned_by_previous_sources = !file.source_keys.is_empty()
                        && file
                            .source_keys
                            .iter()
                            .all(|key| previous_source_keys.contains(key));
                    let derived_from_current_listing = expected_old_files
                        .get(&portable_path_identity(&file.relative_path))
                        .is_some_and(|expected| file.track_id == expected.track_id);
                    owned_by_previous_sources
                        && (derived_from_current_listing
                            || authenticated_by_server_song(
                                file,
                                &known_songs,
                                &previous_sources,
                                &previous_collision_sources,
                                previous_layout_mode,
                            ))
                })
                .collect()
        })
        .unwrap_or(derived_old_files);
    let expected_old_playlists = derived_old
        .manifest_playlists
        .iter()
        .map(|playlist| (portable_path_identity(&playlist.relative_path), playlist))
        .collect::<HashMap<_, _>>();
    let materialized_old_playlists = previous_manifest.as_ref().and_then(old_manifest_playlists);
    let old_playlists = materialized_old_playlists
        .clone()
        .map(|playlists| {
            playlists
                .into_iter()
                .filter(|playlist| {
                    expected_old_playlists
                        .get(&portable_path_identity(&playlist.relative_path))
                        .is_some_and(|expected| playlist.source_key == expected.source_key)
                })
                .collect()
        })
        .unwrap_or(derived_old.manifest_playlists);

    let desired_paths = desired
        .files
        .values()
        .map(|file| portable_path_identity(&file.relative_path))
        .collect::<HashSet<_>>();
    let desired_tracks_by_path = desired
        .files
        .values()
        .map(|file| {
            (
                portable_path_identity(&file.relative_path),
                file.track_id.as_str(),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut desired_paths_by_track: HashMap<&str, Vec<&str>> = HashMap::new();
    for file in desired.files.values() {
        desired_paths_by_track
            .entry(&file.track_id)
            .or_default()
            .push(&file.relative_path);
    }
    let mut old_files_by_path = HashMap::new();
    for file in &old_files {
        let path_identity = portable_path_identity(&file.relative_path);
        if old_files_by_path
            .insert(path_identity, file.track_id.as_str())
            .is_some_and(|track_id| track_id != file.track_id)
        {
            return Err("DEVICE_SYNC_MANIFEST_PLAN_INVALID".to_string());
        }
    }
    let resume_files_by_path = resume_files
        .unwrap_or_default()
        .iter()
        .map(|file| {
            (
                portable_path_identity(&file.relative_path),
                file.track_id.as_str(),
            )
        })
        .collect::<HashMap<_, _>>();

    let mut delete_paths = Vec::new();
    let mut deferred_delete_paths = Vec::new();
    let mut move_paths = Vec::new();
    let mut moved_into = HashSet::new();
    let mut del_bytes = 0_u64;
    let mut reclaimable_bytes = 0_u64;
    for old in &old_files {
        let path_identity = portable_path_identity(&old.relative_path);
        if desired_paths.contains(&path_identity) {
            let desired_track_id = desired_tracks_by_path.get(&path_identity).copied();
            if desired_track_id != Some(old.track_id.as_str()) {
                return Err(format!(
                    "DEVICE_SYNC_PATH_IDENTITY_COLLISION:{}",
                    old.relative_path
                ));
            }
            continue;
        }
        let Some(absolute) = resolve_within_root(root, &old.relative_path) else {
            return Err("DEVICE_SYNC_MANIFEST_PATH_INVALID".to_string());
        };
        if !absolute.exists() {
            continue;
        }
        if !planned_path_stays_within(root, &absolute).map_err(|error| error.to_string())? {
            return Err("DEVICE_SYNC_MANIFEST_PATH_ESCAPES_ROOT".to_string());
        }
        // A copy that is still current but now belongs elsewhere (a playlist
        // reorder renumbers self-contained files) moves instead of being
        // deleted and fetched again.
        let move_target = desired.files.iter().find(|(key, file)| {
            file.track_id == old.track_id
                && !moved_into.contains(*key)
                && file_extension_identity(&file.relative_path)
                    == file_extension_identity(&old.relative_path)
                && !copy_is_stale(old, file, transcode)
                && resolve_within_root(root, &file.relative_path).is_some_and(|next| {
                    !next.exists() && planned_path_stays_within(root, &next).unwrap_or(false)
                })
        });
        if let Some((key, file)) = move_target {
            moved_into.insert(key.clone());
            move_paths.push(DeviceSyncPlannedMove {
                from: old.relative_path.clone(),
                to: file.relative_path.clone(),
            });
            continue;
        }
        del_bytes = del_bytes.saturating_add(old.size_bytes);
        let waits_for_replacement = desired_paths_by_track
            .get(old.track_id.as_str())
            .is_some_and(|paths| {
                paths
                    .iter()
                    .any(|path| resolve_within_root(root, path).is_some_and(|next| !next.exists()))
            });
        if waits_for_replacement {
            deferred_delete_paths.push(absolute.to_string_lossy().to_string());
        } else {
            reclaimable_bytes = reclaimable_bytes.saturating_add(old.size_bytes);
            delete_paths.push(absolute.to_string_lossy().to_string());
        }
    }

    let desired_playlist_paths = desired
        .manifest_playlists
        .iter()
        .map(|playlist| portable_path_identity(&playlist.relative_path))
        .collect::<HashSet<_>>();
    for old in &old_playlists {
        if desired_playlist_paths.contains(&portable_path_identity(&old.relative_path)) {
            continue;
        }
        let Some(absolute) = resolve_within_root(root, &old.relative_path) else {
            return Err("DEVICE_SYNC_MANIFEST_PATH_INVALID".to_string());
        };
        if absolute.exists() {
            if !planned_path_stays_within(root, &absolute).map_err(|error| error.to_string())? {
                return Err("DEVICE_SYNC_MANIFEST_PATH_ESCAPES_ROOT".to_string());
            }
            delete_paths.push(absolute.to_string_lossy().to_string());
        }
    }

    let old_files_by_identity = old_files
        .iter()
        .map(|file| (portable_path_identity(&file.relative_path), file))
        .collect::<HashMap<_, _>>();
    let mut tracks = Vec::new();
    let mut add_bytes = 0_u64;
    for (key, file) in &desired.files {
        let Some(absolute) = resolve_within_root(root, &file.relative_path) else {
            return Err("DEVICE_SYNC_PLANNED_PATH_INVALID".to_string());
        };
        if !planned_path_stays_within(root, &absolute).map_err(|error| error.to_string())? {
            return Err("DEVICE_SYNC_PLANNED_PATH_ESCAPES_ROOT".to_string());
        }
        if moved_into.contains(key) {
            continue;
        }
        let mut overwrite = false;
        if absolute.exists() {
            if has_materialized_plan
                && old_files_by_path
                    .get(&portable_path_identity(&file.relative_path))
                    .copied()
                    != Some(file.track_id.as_str())
                && resume_files_by_path
                    .get(&portable_path_identity(&file.relative_path))
                    .copied()
                    != Some(file.track_id.as_str())
            {
                return Err(format!(
                    "DEVICE_SYNC_PATH_IDENTITY_COLLISION:{}",
                    file.relative_path
                ));
            }
            let stale = old_files_by_identity
                .get(&portable_path_identity(&file.relative_path))
                .is_some_and(|old| {
                    old.track_id == file.track_id && copy_is_stale(old, file, transcode)
                });
            if !stale {
                continue;
            }
            overwrite = true;
        }
        let mut track = file.track.clone();
        if let Some(suffix) = transcode.target_suffix() {
            inject_target_suffix(&mut track, suffix);
        }
        if overwrite {
            inject_overwrite(&mut track);
        }
        inject_playlist_context(
            &mut track,
            file.playlist_name.as_deref(),
            file.playlist_id.as_deref(),
            file.playlist_index,
        );
        if layout_mode == DeviceSyncLayoutMode::Flat {
            inject_flat_layout(&mut track);
        }
        add_bytes = add_bytes.saturating_add(file.size_bytes);
        tracks.push(track);
    }

    let authenticated_file_paths = old_files
        .iter()
        .map(|file| portable_path_identity(&file.relative_path))
        .collect::<HashSet<_>>();
    let mut desired_manifest_files = manifest_files(&desired, transcode);
    desired_manifest_files.extend(retained_manifest_files(
        root,
        materialized_old_files.unwrap_or_default(),
        &authenticated_file_paths,
        &desired_paths,
    ));
    desired_manifest_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let authenticated_playlist_paths = old_playlists
        .iter()
        .map(|playlist| portable_path_identity(&playlist.relative_path))
        .collect::<HashSet<_>>();
    let mut desired_manifest_playlists = desired.manifest_playlists;
    desired_manifest_playlists.extend(retained_manifest_playlists(
        root,
        materialized_old_playlists.unwrap_or_default(),
        &authenticated_playlist_paths,
        &desired_playlist_paths,
    ));
    desired_manifest_playlists.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(SyncDeltaResult {
        plan_id: String::new(),
        device_id: String::new(),
        add_bytes,
        add_count: tracks.len() as u32,
        del_bytes,
        del_count: (delete_paths.len() + deferred_delete_paths.len()) as u32,
        reclaimable_bytes,
        available_bytes: 0,
        tracks,
        delete_paths,
        deferred_delete_paths,
        move_count: move_paths.len() as u32,
        move_paths,
        playlists: desired.playlists,
        manifest_files: desired_manifest_files,
        manifest_playlists: desired_manifest_playlists,
    })
}
