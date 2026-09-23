use crate::file_transfer::apply_server_http_get;
use crate::sync::device::TrackSyncInfo;

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubsonicAuthPayload {
    pub(super) base_url: String,
    pub(super) u: String,
    pub(super) t: String,
    pub(super) s: String,
    pub(super) v: String,
    pub(super) c: String,
    pub(super) f: String,
    pub(super) server_id: String,
    pub(super) server_index_key: String,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSyncSourcePayload {
    #[serde(rename = "type")]
    pub(super) source_type: String,
    pub(super) id: String,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) path_id: Option<String>,
    pub(super) server_index_key: String,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeviceSyncLayoutMode {
    #[default]
    SelfContained,
    SharedAlbumTree,
    /// Every track straight in the device root, playlists as `.m3u8` next to
    /// them — for players that cannot browse folders.
    Flat,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeviceSyncPlaylistPathMode {
    #[default]
    PlaylistRelative,
    DeviceRooted,
    /// Full filesystem paths — for local-folder targets whose playlists are
    /// imported by DJ software that does not resolve relative entries.
    Absolute,
}

/// Output format of a synced file. `Original` copies the server file as-is;
/// the others ask the server to transcode through `stream.view`.
#[derive(
    Clone, Copy, Debug, Default, Eq, PartialEq, serde::Deserialize, serde::Serialize, specta::Type,
)]
#[serde(rename_all = "lowercase")]
pub enum DeviceSyncTranscodeFormat {
    #[default]
    Original,
    Mp3,
    Aac,
    Opus,
}

#[derive(
    Clone, Copy, Debug, Default, Eq, PartialEq, serde::Deserialize, serde::Serialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSyncTranscode {
    #[serde(default)]
    pub format: DeviceSyncTranscodeFormat,
    /// Bitrate cap in kbps; `0` leaves the choice to the server.
    #[serde(default)]
    pub max_bit_rate_kbps: u32,
}

impl DeviceSyncTranscode {
    /// Original files carry no bitrate cap, so two originals always compare equal.
    pub(crate) fn normalized(self) -> Self {
        match self.format {
            DeviceSyncTranscodeFormat::Original => Self::default(),
            _ => self,
        }
    }

    /// File extension the server produces, or `None` to keep the source suffix.
    pub(crate) fn target_suffix(self) -> Option<&'static str> {
        match self.format {
            DeviceSyncTranscodeFormat::Original => None,
            DeviceSyncTranscodeFormat::Mp3 => Some("mp3"),
            DeviceSyncTranscodeFormat::Aac => Some("aac"),
            DeviceSyncTranscodeFormat::Opus => Some("opus"),
        }
    }
}

/// What the server reported about a track's source file when it was synced.
/// A mismatch on the next run means the file was replaced on the server.
#[derive(
    Clone, Debug, Default, Eq, PartialEq, serde::Deserialize, serde::Serialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSyncSourceFingerprint {
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub suffix: Option<String>,
    #[serde(default)]
    pub bit_rate: Option<u32>,
}

impl DeviceSyncSourceFingerprint {
    pub(crate) fn from_subsonic_json(track: &serde_json::Value) -> Self {
        Self {
            size: track.get("size").and_then(serde_json::Value::as_u64),
            suffix: track
                .get("suffix")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            bit_rate: track
                .get("bitRate")
                .and_then(serde_json::Value::as_u64)
                .map(|value| value as u32),
        }
    }
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSyncPlannedPlaylist {
    pub source_key: String,
    pub name: String,
    pub path_id: Option<String>,
    pub relative_path: String,
    pub tracks: Vec<serde_json::Value>,
    pub references: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSyncManifestFile {
    pub track_id: String,
    pub relative_path: String,
    pub source_keys: Vec<String>,
    pub size_bytes: u64,
    /// How the file was produced. Absent on manifests written before
    /// transcoding existed, which only ever held originals.
    #[serde(default)]
    pub transcode: Option<DeviceSyncTranscode>,
    /// Server-side source file the copy was made from. Absent on older manifests.
    #[serde(default)]
    pub source: Option<DeviceSyncSourceFingerprint>,
}

impl DeviceSyncManifestFile {
    pub(crate) fn effective_transcode(&self) -> DeviceSyncTranscode {
        self.transcode.unwrap_or_default().normalized()
    }
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSyncManifestPlaylist {
    pub source_key: String,
    pub relative_path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDeltaResult {
    pub(crate) plan_id: String,
    pub(crate) device_id: String,
    pub(crate) add_bytes: u64,
    pub(crate) add_count: u32,
    pub(crate) del_bytes: u64,
    pub(crate) del_count: u32,
    pub(crate) reclaimable_bytes: u64,
    pub(crate) available_bytes: u64,
    pub(crate) tracks: Vec<serde_json::Value>,
    pub(crate) delete_paths: Vec<String>,
    pub(crate) deferred_delete_paths: Vec<String>,
    /// Existing files relocated on the device instead of downloaded again.
    pub(crate) move_count: u32,
    /// Recorded in the persisted plan and applied by finalize; the frontend
    /// only needs the count.
    #[serde(skip)]
    pub(crate) move_paths: Vec<super::planner::DeviceSyncPlannedMove>,
    pub(crate) playlists: Vec<DeviceSyncPlannedPlaylist>,
    pub(crate) manifest_files: Vec<DeviceSyncManifestFile>,
    pub(crate) manifest_playlists: Vec<DeviceSyncManifestPlaylist>,
}

pub async fn fetch_subsonic_songs(
    client: &reqwest::Client,
    registry: Option<&psysonic_core::server_http::ServerHttpRegistry>,
    auth: &SubsonicAuthPayload,
    endpoint: &str,
    id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let url = format!("{}/{}", auth.base_url, endpoint);
    let query = vec![
        ("u", auth.u.as_str()),
        ("t", auth.t.as_str()),
        ("s", auth.s.as_str()),
        ("v", auth.v.as_str()),
        ("c", auth.c.as_str()),
        ("f", auth.f.as_str()),
        ("id", id),
    ];
    let res = apply_server_http_get(client, registry, Some(&auth.server_id), &url)
        .query(&query)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let json: serde_json::Value = res.json().await.map_err(|error| error.to_string())?;
    parse_subsonic_songs(&json, endpoint)
}

/// Looks up one song by id. `Ok(None)` means the server no longer knows it.
pub(crate) async fn fetch_subsonic_song(
    client: &reqwest::Client,
    registry: Option<&psysonic_core::server_http::ServerHttpRegistry>,
    auth: &SubsonicAuthPayload,
    id: &str,
) -> Result<Option<serde_json::Value>, String> {
    let url = format!("{}/getSong.view", auth.base_url);
    let query = vec![
        ("u", auth.u.as_str()),
        ("t", auth.t.as_str()),
        ("s", auth.s.as_str()),
        ("v", auth.v.as_str()),
        ("c", auth.c.as_str()),
        ("f", auth.f.as_str()),
        ("id", id),
    ];
    let res = apply_server_http_get(client, registry, Some(&auth.server_id), &url)
        .query(&query)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let json: serde_json::Value = res.json().await.map_err(|error| error.to_string())?;
    Ok(parse_subsonic_song(&json, id))
}

/// The `song` of a `getSong.view` response, if it is the requested one.
pub(crate) fn parse_subsonic_song(json: &serde_json::Value, id: &str) -> Option<serde_json::Value> {
    subsonic_response_root(json)
        .ok()?
        .get("song")
        .filter(|song| song.get("id").and_then(serde_json::Value::as_str) == Some(id))
        .cloned()
}

pub(crate) fn estimate_track_size_bytes(
    track: &serde_json::Value,
    transcode: DeviceSyncTranscode,
) -> u64 {
    if transcode.target_suffix().is_some() {
        let kbps = match transcode.max_bit_rate_kbps {
            0 => 320,
            kbps => u64::from(kbps),
        };
        return track
            .get("duration")
            .and_then(|duration| duration.as_u64())
            .unwrap_or(0)
            * kbps
            * 1000
            / 8;
    }
    track
        .get("size")
        .and_then(|size| size.as_u64())
        .unwrap_or_else(|| {
            track
                .get("duration")
                .and_then(|duration| duration.as_u64())
                .unwrap_or(0)
                * 320_000
                / 8
        })
}

pub(crate) fn track_sync_info_from_subsonic_json(
    track: &serde_json::Value,
    track_id: &str,
    playlist_name: Option<&str>,
    playlist_id: Option<&str>,
    playlist_index: Option<u32>,
) -> TrackSyncInfo {
    let suffix = track
        .get("suffix")
        .and_then(|value| value.as_str())
        .unwrap_or("mp3");
    let artist_raw = track
        .get("artist")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let album_artist = track
        .get("albumArtist")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(artist_raw);
    TrackSyncInfo {
        id: track_id.to_string(),
        url: String::new(),
        suffix: suffix.to_string(),
        artist: artist_raw.to_string(),
        album_artist: album_artist.to_string(),
        album: track
            .get("album")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        title: track
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        track_number: track
            .get("track")
            .and_then(|value| value.as_u64())
            .map(|number| number as u32),
        duration: track
            .get("duration")
            .and_then(|value| value.as_u64())
            .map(|number| number as u32),
        playlist_name: playlist_name.map(str::to_string),
        playlist_id: playlist_id.map(str::to_string),
        playlist_index,
        flat_layout: false,
        overwrite: false,
    }
}

/// Marks a planned track as transcoded: the file on the device carries the
/// target extension, while the source suffix stays available for display.
pub(crate) fn inject_target_suffix(track: &mut serde_json::Value, suffix: &str) {
    if let Some(object) = track.as_object_mut() {
        if let Some(source_suffix) = object.get("suffix").cloned() {
            object.insert("_sourceSuffix".to_string(), source_suffix);
        }
        object.insert(
            "suffix".to_string(),
            serde_json::Value::String(suffix.to_string()),
        );
    }
}

/// Marks a planned track whose existing copy must be replaced in place.
pub(crate) fn inject_overwrite(track: &mut serde_json::Value) {
    if let Some(object) = track.as_object_mut() {
        object.insert("_overwrite".to_string(), serde_json::Value::Bool(true));
    }
}

/// Marks a planned track for the flat layout, so the `TrackSyncInfo` the
/// frontend hands back to `sync_batch_to_device` builds the same path the
/// plan recorded.
pub(crate) fn inject_flat_layout(track: &mut serde_json::Value) {
    if let Some(object) = track.as_object_mut() {
        object.insert("_flatLayout".to_string(), serde_json::Value::Bool(true));
    }
}

pub(crate) fn inject_playlist_context(
    track: &mut serde_json::Value,
    playlist_name: Option<&str>,
    playlist_id: Option<&str>,
    playlist_index: Option<u32>,
) {
    if let Some(object) = track.as_object_mut() {
        if let Some(name) = playlist_name {
            object.insert(
                "_playlistName".to_string(),
                serde_json::Value::String(name.to_string()),
            );
        }
        if let Some(id) = playlist_id {
            object.insert(
                "_playlistId".to_string(),
                serde_json::Value::String(id.to_string()),
            );
        }
        if let Some(index) = playlist_index {
            object.insert(
                "_playlistIndex".to_string(),
                serde_json::Value::Number(index.into()),
            );
        }
    }
}

pub(crate) fn subsonic_response_root(
    json: &serde_json::Value,
) -> Result<&serde_json::Value, String> {
    let root = json
        .get("subsonic-response")
        .ok_or_else(|| "No subsonic-response".to_string())?;
    if root.get("status").and_then(|value| value.as_str()) == Some("failed") {
        let message = root
            .get("error")
            .and_then(|value| value.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("Subsonic request failed");
        return Err(message.to_string());
    }
    Ok(root)
}

pub fn parse_subsonic_songs(
    json: &serde_json::Value,
    endpoint: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let root = subsonic_response_root(json)?;
    let songs = if endpoint == "getAlbum.view" {
        root.get("album").and_then(|album| album.get("song"))
    } else if endpoint == "getPlaylist.view" {
        root.get("playlist")
            .and_then(|playlist| playlist.get("entry"))
    } else {
        None
    };

    if let Some(array) = songs.and_then(|value| value.as_array()) {
        return Ok(array.clone());
    }
    if let Some(object) = songs.and_then(|value| value.as_object()) {
        return Ok(vec![serde_json::Value::Object(object.clone())]);
    }
    Ok(vec![])
}
