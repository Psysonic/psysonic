-- CREATE-only safety net for the final additive label schema (32 + 33).
CREATE TABLE IF NOT EXISTS track_label (
  server_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  label TEXT NOT NULL,
  album_id TEXT,
  library_id TEXT,
  label_key TEXT,
  PRIMARY KEY (server_id, track_id, label COLLATE NOCASE),
  FOREIGN KEY (server_id, track_id)
    REFERENCES track(server_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_track_label_browse
  ON track_label(server_id, label COLLATE NOCASE, album_id, track_id)
  WHERE album_id IS NOT NULL AND album_id != '';
CREATE INDEX IF NOT EXISTS idx_track_label_key_browse
  ON track_label(server_id, label_key, album_id, track_id, label, library_id)
  WHERE album_id IS NOT NULL AND album_id != '';
