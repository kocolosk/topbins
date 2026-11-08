export interface MediaDTO {
  id: string;
  width: number;
  height: number;
  captureTime: string | null;
  credit: string | null;
  copyright: string | null;
  usageTerms: string | null;
  rightsUrl: string | null;
  gridUrl: string;
  viewerUrl: string;
  downloadUrl: string;
}

export interface AlbumDTO {
  id: string;
  teamId: string;
  seasonId: string;
  teamTitle: string;
  seasonTitle: string;
  title: string;
  date: string;
  visibility: string;
  coverMediaId: string | null;
  media: MediaDTO[];
}

interface CatalogRow {
  id: string;
  team_id: string;
  season_id: string;
  team_title: string;
  season_title: string;
  title: string;
  date: string;
  visibility: string;
  cover_media_id: string | null;
  media_id: string | null;
  source_sha256: string;
  width: number;
  height: number;
  capture_time: string | null;
  capture_original: unknown;
  capture_offset: unknown;
  credit: string | null;
  copyright: string | null;
  usage_terms: string | null;
  rights_url: string | null;
}

// Eligibility, album metadata, and media are read in one statement/snapshot.
// Never authorize an album and then read its potentially newly restricted
// contents in a second query. Extract only approved capture fields from private
// records; never return the metadata object or original filename.
async function readAlbums(
  db: D1Database,
  predicate: string,
  bindings: string[],
  preview = false,
): Promise<AlbumDTO[]> {
  const { results } = await db
    .prepare(`
    SELECT a.id, a.team_id, a.season_id, t.title AS team_title,
      s.title AS season_title, a.title, a.date, a.visibility, a.cover_media_id,
      m.id AS media_id, m.source_sha256, m.width, m.height, m.capture_time,
      json_extract(p.metadata, '$.captureTimeOriginal') AS capture_original,
      json_extract(p.metadata, '$.captureOffsetOriginal') AS capture_offset,
      m.credit, m.copyright, m.usage_terms, m.rights_url
    FROM albums a
    JOIN seasons s ON s.id=a.season_id AND s.team_id=a.team_id
    JOIN teams t ON t.id=a.team_id
    LEFT JOIN media m ON m.album_id=a.id
    LEFT JOIN media_private p ON p.media_id=m.id
    WHERE ${predicate}
    ORDER BY a.date DESC, a.id,
      COALESCE(json_extract(p.metadata, '$.originalFilename'), m.id), m.id
  `)
    .bind(...bindings)
    .all<CatalogRow>();
  const albums = new Map<string, AlbumDTO>();
  for (const row of results) {
    let album = albums.get(row.id);
    if (!album) {
      album = {
        id: row.id,
        teamId: row.team_id,
        seasonId: row.season_id,
        teamTitle: row.team_title,
        seasonTitle: row.season_title,
        title: row.title,
        date: row.date,
        visibility: row.visibility,
        coverMediaId: row.cover_media_id,
        media: [],
      };
      albums.set(row.id, album);
    }
    if (row.media_id) {
      const base = `${preview ? "/preview" : ""}/media/${row.media_id}/${row.source_sha256}`;
      album.media.push({
        id: row.media_id,
        width: row.width,
        height: row.height,
        captureTime: publicCaptureTime(
          row.capture_time,
          row.capture_original,
          row.capture_offset,
        ),
        credit: row.credit,
        copyright: row.copyright,
        usageTerms: row.usage_terms,
        rightsUrl: row.rights_url,
        gridUrl: `${base}/grid`,
        viewerUrl: `${base}/viewer`,
        downloadUrl: `${base}/download`,
      });
    }
  }
  return [...albums.values()];
}

function publicCaptureTime(
  stored: string | null,
  original: unknown,
  offset: unknown,
): string | null {
  if (
    typeof original !== "string" ||
    !/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(original)
  )
    return stored;
  const local = `${original.slice(0, 10).replaceAll(":", "-")}T${original.slice(11)}`;
  const date = new Date(`${local}Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 19) !== local)
    return stored;
  if (typeof offset === "string" && /^[+-]\d{2}:\d{2}$/.test(offset)) {
    const full = local + offset;
    if (stored && Date.parse(full) === Date.parse(stored)) return full;
  }
  // Preserve a wall-clock timestamp without claiming it is a known instant.
  return stored ?? local;
}

export async function getPublicAlbum(
  db: D1Database,
  id: string,
): Promise<AlbumDTO | null> {
  return (
    (
      await readAlbums(
        db,
        "a.id=? AND a.state='published' AND a.visibility='public'",
        [id],
      )
    )[0] ?? null
  );
}

export async function getSharedAlbum(
  db: D1Database,
  token: string,
): Promise<AlbumDTO | null> {
  return (
    (
      await readAlbums(db, "a.share_token=? AND a.state='published'", [token])
    )[0] ?? null
  );
}

export async function getPreviewAlbum(
  db: D1Database,
  id: string,
): Promise<AlbumDTO | null> {
  return (await readAlbums(db, "a.id=?", [id], true))[0] ?? null;
}

export async function listTeams(db: D1Database) {
  return (
    await db
      .prepare(`SELECT DISTINCT t.id, t.title FROM teams t JOIN albums a ON a.team_id=t.id
      WHERE a.state='published' AND a.visibility='public' ORDER BY t.title, t.id`)
      .all<{ id: string; title: string }>()
  ).results;
}

export async function listSeasons(db: D1Database, teamId: string) {
  return (
    await db
      .prepare(`SELECT DISTINCT s.id, s.team_id AS teamId, s.title FROM seasons s
      JOIN albums a ON a.season_id=s.id AND a.team_id=s.team_id
      WHERE s.team_id=? AND a.state='published' AND a.visibility='public'
      ORDER BY s.title, s.id`)
      .bind(teamId)
      .all<{ id: string; teamId: string; title: string }>()
  ).results;
}

export async function listAlbums(
  db: D1Database,
  teamId: string,
  seasonId: string,
): Promise<AlbumDTO[]> {
  return readAlbums(
    db,
    "a.team_id=? AND a.season_id=? AND a.state='published' AND a.visibility='public'",
    [teamId, seasonId],
  );
}
