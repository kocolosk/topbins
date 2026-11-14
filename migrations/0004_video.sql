ALTER TABLE media ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo'
  CHECK (kind IN ('photo', 'video'));
ALTER TABLE media ADD COLUMN duration REAL;
ALTER TABLE media ADD COLUMN poster_sha256 TEXT;
