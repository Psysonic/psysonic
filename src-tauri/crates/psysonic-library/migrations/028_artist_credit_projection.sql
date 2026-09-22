-- Materialized structured artist credits. Track raw_json remains authoritative;
-- this table makes artists[] / albumArtists[] usable without JSON scans on
-- artist browse and detail hot paths.
CREATE TABLE IF NOT EXISTS artist_credit_projection (
  server_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  artist_key TEXT NOT NULL,
  credit_kind TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, track_id, artist_id, credit_kind),
  FOREIGN KEY (server_id, track_id) REFERENCES track(server_id, id) ON DELETE CASCADE,
  CHECK (credit_kind IN ('track', 'album'))
);

CREATE INDEX IF NOT EXISTS idx_artist_credit_projection_owner
  ON artist_credit_projection(server_id, artist_id, is_primary, library_id, track_id);

CREATE INDEX IF NOT EXISTS idx_artist_credit_projection_scope
  ON artist_credit_projection(server_id, library_id, credit_kind, artist_key, album_id, track_id);

CREATE INDEX IF NOT EXISTS idx_artist_credit_projection_album
  ON artist_credit_projection(server_id, library_id, album_id, credit_kind, artist_id);
