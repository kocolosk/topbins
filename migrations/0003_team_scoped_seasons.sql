-- Season names such as "fall-2026" may be reused by different teams.
-- Rebuild without rewriting the previously applied catalog migration.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE seasons_scoped (
  id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  title TEXT NOT NULL,
  PRIMARY KEY (team_id, id)
);
INSERT INTO seasons_scoped SELECT id, team_id, title FROM seasons;

CREATE TABLE albums_scoped (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'unlisted')),
  state TEXT NOT NULL CHECK (state IN ('draft', 'published')),
  share_token TEXT NOT NULL UNIQUE,
  cover_media_id TEXT,
  FOREIGN KEY (team_id, season_id) REFERENCES seasons_scoped(team_id, id)
);
INSERT INTO albums_scoped
  SELECT a.id, s.team_id, a.season_id, a.title, a.date, a.visibility,
         a.state, a.share_token, a.cover_media_id
  FROM albums a JOIN seasons s ON s.id = a.season_id;

-- Rebuild dependent tables too, so dropping the old parent does not leave
-- deferred foreign-key violations for catalogs that already contain media.
CREATE TABLE media_scoped (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums_scoped(id),
  source_sha256 TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  capture_time TEXT,
  credit TEXT,
  copyright TEXT,
  usage_terms TEXT,
  rights_url TEXT
);
INSERT INTO media_scoped SELECT * FROM media;
CREATE TABLE media_private_scoped (
  media_id TEXT PRIMARY KEY REFERENCES media_scoped(id),
  metadata TEXT NOT NULL
);
INSERT INTO media_private_scoped SELECT * FROM media_private;

DROP TABLE media_private;
DROP TABLE media;
DROP TABLE albums;
DROP TABLE seasons;
ALTER TABLE seasons_scoped RENAME TO seasons;
ALTER TABLE albums_scoped RENAME TO albums;
ALTER TABLE media_scoped RENAME TO media;
ALTER TABLE media_private_scoped RENAME TO media_private;

CREATE INDEX albums_season ON albums(team_id, season_id, state, visibility, date);
CREATE INDEX media_album ON media(album_id);
