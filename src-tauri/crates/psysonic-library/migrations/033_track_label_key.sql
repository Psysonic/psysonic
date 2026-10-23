-- Keep display spelling, but use a Rust-normalized Unicode lowercase key for
-- identity. SQLite NOCASE only folds ASCII. Existing rows are filled by the
-- normal resumable label backfill, not a startup-wide UPDATE.
ALTER TABLE track_label ADD COLUMN label_key TEXT;

CREATE INDEX IF NOT EXISTS idx_track_label_key_browse
  ON track_label(server_id, label_key, album_id, track_id, label, library_id)
  WHERE album_id IS NOT NULL AND album_id != '';

DELETE FROM library_data_migration WHERE id = 'label_tags_v1';
