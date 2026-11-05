-- Album-level release years as the server reports them on `getAlbumList2`
-- (OpenSubsonic `originalReleaseDate` / `releaseDate`). Subsonic song rows only
-- carry `year`, so this is where tracks that did not come through Navidrome's
-- native API get their original and edition year from. Filled by the album
-- census; read per physical album when album rows are built.
CREATE TABLE IF NOT EXISTS album_release_year (
  server_id     TEXT NOT NULL,
  album_id      TEXT NOT NULL,
  original_year INTEGER,
  release_year  INTEGER,
  PRIMARY KEY (server_id, album_id)
);
