ALTER TABLE artist ADD COLUMN starred_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_artist_starred_name
  ON artist(server_id, name_sort, id)
  WHERE starred_at IS NOT NULL;
