-- Normalized OpenSubsonic MOOD/TMOO projection.
-- One row per track + mood, carrying album/library ownership for browse queries.
CREATE TABLE IF NOT EXISTS track_mood (
  server_id  TEXT NOT NULL,
  track_id   TEXT NOT NULL,
  mood       TEXT NOT NULL,
  album_id   TEXT,
  library_id TEXT,
  PRIMARY KEY (server_id, track_id, mood COLLATE NOCASE),
  FOREIGN KEY (server_id, track_id)
    REFERENCES track(server_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_track_mood_browse
  ON track_mood(server_id, mood COLLATE NOCASE, album_id, track_id)
  WHERE album_id IS NOT NULL AND album_id != '';