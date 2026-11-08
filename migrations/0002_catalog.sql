CREATE TABLE teams (id TEXT PRIMARY KEY, title TEXT NOT NULL);
CREATE TABLE seasons (id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id), title TEXT NOT NULL);
CREATE TABLE albums (
  id TEXT PRIMARY KEY, season_id TEXT NOT NULL REFERENCES seasons(id), title TEXT NOT NULL,
  date TEXT NOT NULL, visibility TEXT NOT NULL CHECK (visibility IN ('public','unlisted')),
  state TEXT NOT NULL CHECK (state IN ('draft','published')), share_token TEXT NOT NULL UNIQUE,
  cover_media_id TEXT
);
CREATE TABLE media (
  id TEXT PRIMARY KEY, album_id TEXT NOT NULL REFERENCES albums(id), source_sha256 TEXT NOT NULL,
  width INTEGER NOT NULL, height INTEGER NOT NULL, capture_time TEXT,
  credit TEXT, copyright TEXT, usage_terms TEXT, rights_url TEXT
);
CREATE INDEX media_album ON media(album_id);
CREATE TABLE media_private (media_id TEXT PRIMARY KEY REFERENCES media(id), metadata TEXT NOT NULL);
