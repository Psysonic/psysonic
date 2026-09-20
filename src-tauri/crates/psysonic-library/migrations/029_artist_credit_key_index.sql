-- Candidate-first artist album counts look up all structured credits for a
-- normalized artist inside each selected server/library scope.
CREATE INDEX IF NOT EXISTS idx_artist_credit_projection_artist_key
  ON artist_credit_projection(server_id, artist_key, library_id, album_id);
