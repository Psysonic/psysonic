//! Normalized record labels from track `raw_json`.
//!
//! Navidrome's native song rows carry `tags.recordlabel` (array of strings);
//! OpenSubsonic `getAlbum` rows carry the album's `recordLabels[{name}]`, which
//! sync copies onto each song. This module normalizes both into the local
//! `track_label` projection.

use std::collections::HashSet;

use rusqlite::{params, Transaction};
use serde_json::Value;

/// Zero-width and direction marks that taggers leave behind (e.g. a trailing U+200E).
fn is_invisible_mark(ch: char) -> bool {
    matches!(
        ch,
        '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}' | '\u{FEFF}'
    )
}

/// Label as stored and shown: invisible marks removed, whitespace trimmed.
pub fn clean_label(raw: &str) -> String {
    raw.chars()
        .filter(|ch| !is_invisible_mark(*ch))
        .collect::<String>()
        .trim()
        .to_string()
}

fn dedupe_labels(labels: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for label in labels {
        let cleaned = clean_label(&label);
        if cleaned.is_empty() {
            continue;
        }
        if seen.insert(cleaned.to_lowercase()) {
            out.push(cleaned);
        }
    }
    out
}

/// `["A", "B"]`, `"A"`, or `[{"name": "A"}]` — every shape servers use.
fn label_strings(value: &Value) -> Vec<String> {
    match value {
        Value::String(label) => vec![label.clone()],
        Value::Array(items) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(label) => Some(label.clone()),
                Value::Object(obj) => obj.get("name").and_then(Value::as_str).map(String::from),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

pub fn labels_for_track_value(raw_json: &Value) -> Vec<String> {
    let mut labels = Vec::new();
    if let Some(tags) = raw_json.pointer("/tags/recordlabel") {
        labels.extend(label_strings(tags));
    }
    if let Some(open_subsonic) = raw_json.get("recordLabels") {
        labels.extend(label_strings(open_subsonic));
    }
    dedupe_labels(labels)
}

/// Labels from the SQLite `json_extract()` results of `$.tags.recordlabel` and
/// `$.recordLabels`: arrays come back as JSON text, scalars as plain text.
pub fn labels_for_track_extracted(extracted: &[Option<&str>]) -> Vec<String> {
    let mut labels = Vec::new();
    for raw in extracted
        .iter()
        .flatten()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        if raw.starts_with('[') {
            if let Ok(value) = serde_json::from_str::<Value>(raw) {
                labels.extend(label_strings(&value));
                continue;
            }
        }
        labels.push(raw.to_string());
    }
    dedupe_labels(labels)
}

pub fn replace_track_label_rows(
    tx: &Transaction<'_>,
    server_id: &str,
    track_id: &str,
    album_id: Option<&str>,
    library_id: Option<&str>,
    labels: &[String],
) -> rusqlite::Result<()> {
    tx.execute(
        "DELETE FROM track_label WHERE server_id = ?1 AND track_id = ?2",
        params![server_id, track_id],
    )?;
    if labels.is_empty() {
        return Ok(());
    }
    let mut insert = tx.prepare_cached(
        "INSERT OR IGNORE INTO track_label \
         (server_id, track_id, label, album_id, library_id) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for label in labels {
        insert.execute(params![server_id, track_id, label, album_id, library_id])?;
    }
    Ok(())
}

pub fn delete_track_label_for_track(
    conn: &rusqlite::Connection,
    server_id: &str,
    track_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM track_label WHERE server_id = ?1 AND track_id = ?2",
        params![server_id, track_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_navidrome_native_recordlabel_tag() {
        let raw = json!({ "tags": { "recordlabel": ["Warp", "Bleep"] } });
        assert_eq!(
            labels_for_track_value(&raw),
            vec!["Warp".to_string(), "Bleep".to_string()]
        );
    }

    #[test]
    fn reads_open_subsonic_record_labels_objects() {
        let raw = json!({ "recordLabels": [{ "name": "Transmigration" }] });
        assert_eq!(
            labels_for_track_value(&raw),
            vec!["Transmigration".to_string()]
        );
    }

    #[test]
    fn strips_invisible_marks_and_dedupes_case_insensitively() {
        let raw = json!({
            "tags": { "recordlabel": ["Deram \u{200E}", "deram", " ", "!K7"] },
            "recordLabels": [{ "name": "!K7 Records" }, { "name": "DERAM" }]
        });
        assert_eq!(
            labels_for_track_value(&raw),
            vec![
                "Deram".to_string(),
                "!K7".to_string(),
                "!K7 Records".to_string()
            ]
        );
    }

    #[test]
    fn missing_labels_return_empty() {
        assert!(labels_for_track_value(&json!({ "tags": { "genre": ["Rock"] } })).is_empty());
    }

    #[test]
    fn extracted_values_accept_json_arrays_and_scalars() {
        assert_eq!(
            labels_for_track_extracted(&[
                Some(r#"["Warp"]"#),
                Some(r#"[{"name":"warp"},{"name":"Bleep"}]"#),
            ]),
            vec!["Warp".to_string(), "Bleep".to_string()]
        );
        assert_eq!(
            labels_for_track_extracted(&[Some("Ninja Tune"), None]),
            vec!["Ninja Tune".to_string()]
        );
    }
}
