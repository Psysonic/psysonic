use serde_json::Value;

pub(super) fn print_library_human(v: &Value) {
    if let Some(sid) = v.get("active_server_id").and_then(|x| x.as_str()) {
        println!("active_server_id: {sid}");
    } else {
        println!("active_server_id: (none)");
    }
    match v.get("selected").and_then(|x| x.as_str()) {
        Some(s) => println!("selected: {s}"),
        None => println!("selected: (unknown)"),
    }
    println!("folders:");
    if let Some(Value::Array(rows)) = v.get("folders") {
        if rows.is_empty() {
            println!("  (none)");
            return;
        }
        for row in rows {
            let id = row.get("id").and_then(|x| x.as_str()).unwrap_or("?");
            let name = row.get("name").and_then(|x| x.as_str()).unwrap_or("?");
            println!("  - {id}\t{name}");
        }
    } else {
        println!("  (invalid JSON: missing folders array)");
    }
}

pub(super) fn print_server_list_human(v: &Value) {
    if let Some(sid) = v.get("active_server_id").and_then(|x| x.as_str()) {
        println!("active_server_id: {sid}");
    } else {
        println!("active_server_id: (none)");
    }
    println!("servers:");
    if let Some(Value::Array(rows)) = v.get("servers") {
        if rows.is_empty() {
            println!("  (none)");
            return;
        }
        for row in rows {
            let id = row.get("id").and_then(|x| x.as_str()).unwrap_or("?");
            let name = row.get("name").and_then(|x| x.as_str()).unwrap_or("?");
            println!("  - {id}\t{name}");
        }
    } else {
        println!("  (invalid JSON: missing servers array)");
    }
}

pub(super) fn print_search_human(v: &Value) {
    if let Some(err) = v.get("error").and_then(|x| x.as_str()) {
        if !err.is_empty() {
            println!("error: {err}");
            return;
        }
    }
    let scope = v.get("scope").and_then(|x| x.as_str()).unwrap_or("?");
    let query = v.get("query").and_then(|x| x.as_str()).unwrap_or("");
    println!("scope: {scope}");
    println!("query: {query}");
    match scope {
        "track" => {
            println!("songs:");
            if let Some(Value::Array(rows)) = v.get("songs") {
                if rows.is_empty() {
                    println!("  (none)");
                    return;
                }
                for row in rows {
                    let id = row.get("id").and_then(|x| x.as_str()).unwrap_or("?");
                    let title = row.get("title").and_then(|x| x.as_str()).unwrap_or("?");
                    let artist = row.get("artist").and_then(|x| x.as_str()).unwrap_or("?");
                    println!("  - {id}\t{artist} — {title}");
                }
            } else {
                println!("  (missing songs array)");
            }
        }
        "album" => {
            println!("albums:");
            if let Some(Value::Array(rows)) = v.get("albums") {
                if rows.is_empty() {
                    println!("  (none)");
                    return;
                }
                for row in rows {
                    let id = row.get("id").and_then(|x| x.as_str()).unwrap_or("?");
                    let name = row.get("name").and_then(|x| x.as_str()).unwrap_or("?");
                    let artist = row.get("artist").and_then(|x| x.as_str()).unwrap_or("?");
                    println!("  - {id}\t{artist} — {name}");
                }
            } else {
                println!("  (missing albums array)");
            }
        }
        "artist" => {
            println!("artists:");
            if let Some(Value::Array(rows)) = v.get("artists") {
                if rows.is_empty() {
                    println!("  (none)");
                    return;
                }
                for row in rows {
                    let id = row.get("id").and_then(|x| x.as_str()).unwrap_or("?");
                    let name = row.get("name").and_then(|x| x.as_str()).unwrap_or("?");
                    println!("  - {id}\t{name}");
                }
            } else {
                println!("  (missing artists array)");
            }
        }
        _ => println!("(unknown scope)"),
    }
}

pub(super) fn print_info_human(v: &Value) {
    let o = v.as_object();
    let o = match o {
        Some(m) => m,
        None => {
            println!("(snapshot is not a JSON object)");
            return;
        }
    };

    let track = o.get("current_track").and_then(|x| x.as_object());
    println!("=== current_track ===");
    match track {
        None => println!("(none)"),
        Some(t) if t.is_empty() => println!("(none)"),
        Some(t) => {
            for (k, val) in sorted_kv(t) {
                println!("  {k}: {}", value_inline(val));
            }
        }
    }

    println!("=== current_radio ===");
    match o.get("current_radio") {
        None | Some(Value::Null) => println!("(none)"),
        Some(Value::Object(m)) if m.is_empty() => println!("(none)"),
        Some(Value::Object(m)) => {
            for (k, val) in sorted_kv(m) {
                println!("  {k}: {}", value_inline(val));
            }
        }
        Some(x) => println!("  {}", value_inline(x)),
    }

    println!("=== music_library ===");
    match o.get("music_library").and_then(|x| x.as_object()) {
        None => println!("(none)"),
        Some(m) if m.is_empty() => println!("(none)"),
        Some(m) => {
            if let Some(v) = m.get("selected") {
                println!("  selected: {}", value_inline(v));
            }
            if let Some(v) = m.get("active_server_id") {
                println!("  active_server_id: {}", value_inline(v));
            }
            println!("  folders:");
            match m.get("folders").and_then(|x| x.as_array()) {
                None => println!("    (none loaded)"),
                Some(a) if a.is_empty() => println!("    (none loaded)"),
                Some(rows) => {
                    for row in rows {
                        let id = row.get("id").and_then(|x| x.as_str()).unwrap_or("?");
                        let name = row.get("name").and_then(|x| x.as_str()).unwrap_or("?");
                        println!("    - {id}\t{name}");
                    }
                }
            }
        }
    }

    println!("=== playback ===");
    for key in [
        "is_playing",
        "current_time",
        "volume",
        "queue_index",
        "queue_length",
        "repeat_mode",
        "current_track_user_rating",
        "current_track_starred",
    ] {
        if let Some(val) = o.get(key) {
            println!("  {key}: {}", value_inline(val));
        }
    }

    println!("=== servers (saved) ===");
    match o.get("servers").and_then(|x| x.as_array()) {
        None => println!("(none)"),
        Some(rows) if rows.is_empty() => println!("(none)"),
        Some(rows) => {
            for row in rows {
                let id = row.get("id").and_then(|x| x.as_str()).unwrap_or("?");
                let name = row.get("name").and_then(|x| x.as_str()).unwrap_or("?");
                println!("  - {id}\t{name}");
            }
        }
    }

    println!(
        "=== queue ({} items) ===",
        o.get("queue_length").and_then(|x| x.as_u64()).unwrap_or(0)
    );
    if let Some(Value::Array(items)) = o.get("queue") {
        for (i, item) in items.iter().enumerate() {
            let line = match item {
                Value::Object(m) => {
                    let title = m.get("title").and_then(|x| x.as_str()).unwrap_or("?");
                    let artist = m.get("artist").and_then(|x| x.as_str()).unwrap_or("?");
                    let id = m.get("id").and_then(|x| x.as_str()).unwrap_or("?");
                    format!("[{i}] {artist} — {title} ({id})")
                }
                _ => format!("[{i}] {}", value_inline(item)),
            };
            println!("{line}");
        }
    } else {
        println!("(no queue array in snapshot)");
    }
}

fn sorted_kv(m: &serde_json::Map<String, Value>) -> Vec<(&String, &Value)> {
    let mut v: Vec<_> = m.iter().collect();
    v.sort_by(|a, b| a.0.cmp(b.0));
    v
}

fn value_inline(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "(null)".into(),
        Value::Array(a) => format!("[{} elements]", a.len()),
        Value::Object(m) => format!("{{{} keys}}", m.len()),
    }
}

pub fn print_audio_devices_human(v: &Value) {
    if let Some(def) = v.get("default").and_then(|x| x.as_str()) {
        println!("default_output: {def}");
    } else {
        println!("default_output: (unknown)");
    }
    if let Some(sel) = v.get("selected").and_then(|x| x.as_str()) {
        println!("selected: {sel}");
    } else {
        println!("selected: (host default)");
    }
    println!("devices:");
    if let Some(Value::Array(devs)) = v.get("devices") {
        for d in devs {
            if let Some(s) = d.as_str() {
                println!("  - {s}");
            }
        }
    } else {
        println!("  (none)");
    }
}
