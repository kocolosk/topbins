import { json, readLimitedBody, response } from "./http";
import { uploadVideo } from "./video-upload";

type PublisherEnv = Env & { PUBLISH_TOKEN?: string };
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const limit = 20_000_000;
type Obj = Record<string, unknown>;
function object(x: unknown): x is Obj {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function text(x: unknown, max = 200): x is string {
  return typeof x === "string" && x.trim().length > 0 && x.length <= max;
}
function nullable(x: unknown, max = 2000): boolean {
  return x === null || (typeof x === "string" && x.length <= max);
}
function only(x: Obj, keys: string[]): boolean {
  return Object.keys(x).every((key) => keys.includes(key));
}
function validId(x: unknown): x is string {
  return typeof x === "string" && x.length <= 80 && slug.test(x);
}
function validDate(x: unknown): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(`${x}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === x;
}
function validMedia(x: unknown): x is Obj {
  if (
    !object(x) ||
    !only(x, [
      "id",
      "sha256",
      "width",
      "height",
      "captureTime",
      "credit",
      "copyright",
      "usageTerms",
      "rightsUrl",
      "privateMetadata",
      "replace",
      "kind",
      "duration",
      "posterSha256",
    ])
  )
    return false;
  if (
    typeof x.id !== "string" ||
    !uuid.test(x.id) ||
    typeof x.sha256 !== "string" ||
    !hash.test(x.sha256)
  )
    return false;
  if (
    !Number.isInteger(x.width) ||
    !Number.isInteger(x.height) ||
    (x.width as number) < 1 ||
    (x.height as number) < 1 ||
    (x.width as number) > 12000 ||
    (x.height as number) > 12000 ||
    (x.width as number) * (x.height as number) > 100_000_000
  )
    return false;
  if (
    !(
      x.captureTime === null ||
      (typeof x.captureTime === "string" &&
        x.captureTime.length <= 64 &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
          x.captureTime,
        ) &&
        !Number.isNaN(Date.parse(x.captureTime)))
    )
  )
    return false;
  if (
    !nullable(x.credit) ||
    !nullable(x.copyright) ||
    !nullable(x.usageTerms) ||
    !nullable(x.rightsUrl) ||
    !object(x.privateMetadata) ||
    (x.replace !== undefined && typeof x.replace !== "boolean")
  )
    return false;
  if (x.kind !== undefined && x.kind !== "photo" && x.kind !== "video")
    return false;
  if (x.kind === "video") {
    if (
      typeof x.posterSha256 !== "string" ||
      !hash.test(x.posterSha256) ||
      typeof x.duration !== "number" ||
      !Number.isFinite(x.duration) ||
      x.duration <= 0 ||
      x.duration > 86400
    )
      return false;
  } else if (x.duration != null || x.posterSha256 != null) return false;
  if (x.rightsUrl !== null) {
    try {
      if (
        !["http:", "https:"].includes(new URL(x.rightsUrl as string).protocol)
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function authorized(request: Request, env: PublisherEnv): boolean {
  const expected = env.PUBLISH_TOKEN;
  if (!expected) return false;
  const actual = request.headers.get("Authorization");
  if (!actual?.startsWith("Bearer ")) return false;
  const a = new TextEncoder().encode(actual.slice(7));
  const b = new TextEncoder().encode(expected);
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}
export async function publisher(
  request: Request,
  env: PublisherEnv,
  path: string,
): Promise<Response> {
  if (!authorized(request, env)) return response("Unauthorized", 401);
  const asset = /^\/api\/publisher\/assets\/([0-9a-f]{64})$/.exec(path);
  if (asset) {
    const video = new URL(request.url).searchParams.get("type") === "video/mp4";
    const key = `sources/${asset[1]}.${video ? "mp4" : "jpg"}`;
    if (request.method === "HEAD" || request.method === "GET")
      return (await env.MEDIA.head(key)) ? response(null) : response(null, 404);
    if (request.method !== "PUT") return response("Method not allowed", 405);
    if (video) {
      if (request.headers.get("Content-Type") !== "video/mp4")
        return response("Expected video/mp4", 400);
      return uploadVideo(request, env, asset[1] ?? "");
    }
    if (request.headers.get("Content-Type")?.toLowerCase() !== "image/jpeg")
      return response("Expected image/jpeg", 400);
    if (Number(request.headers.get("Content-Length")) >= limit)
      return response("Asset too large", 413);
    const data = await readLimitedBody(request, limit - 1);
    if (!data) return response("Asset too large", 413);
    if (data.byteLength < 4) return response("Invalid asset size", 400);
    const bytes = data;
    if (
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff ||
      bytes[bytes.length - 1] !== 0xd9
    )
      return response("Invalid JPEG", 400);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== asset[1]) return response("SHA-256 mismatch", 400);
    if (!(await env.MEDIA.head(key))) {
      let dimensions: { width: string; height: string };
      try {
        const info = await env.IMAGES.info(new Blob([data]).stream());
        if (
          info.format !== "image/jpeg" ||
          !("width" in info) ||
          info.width < 1 ||
          info.height < 1 ||
          info.width > 12000 ||
          info.height > 12000 ||
          info.width * info.height > 100_000_000
        )
          return response("Unsupported JPEG dimensions", 400);
        dimensions = {
          width: String(info.width),
          height: String(info.height),
        };
        for (const size of [640, 2560]) {
          const transformed = await env.IMAGES.input(new Blob([data]).stream())
            .transform({ width: size, height: size, fit: "scale-down" })
            .output({ format: "image/jpeg" });
          const result = transformed.response();
          if (!result.ok) return response("Image transformation failed", 400);
          await result.arrayBuffer();
        }
      } catch {
        return response("Image transformation failed", 400);
      }
      await env.MEDIA.put(key, data, {
        httpMetadata: { contentType: "image/jpeg" },
        customMetadata: dimensions,
      });
    }
    return json({ sha256: digest });
  }
  const match = /^\/api\/publisher\/albums\/([a-z0-9-]+)$/.exec(path);
  if (!match || !validId(match[1])) return response("Not found", 404);
  const id = match[1];
  if (request.method === "GET" || request.method === "HEAD") {
    const album = await env.DB.prepare(
      `SELECT a.*, s.title AS season_title, t.title AS team_title FROM albums a JOIN seasons s ON s.id=a.season_id AND s.team_id=a.team_id JOIN teams t ON t.id=s.team_id WHERE a.id=?`,
    )
      .bind(id)
      .first<{
        id: string;
        title: string;
        date: string;
        visibility: string;
        state: string;
        share_token: string;
        cover_media_id: string | null;
        season_id: string;
        season_title: string;
        team_id: string;
        team_title: string;
      }>();
    if (!album) return response("Not found", 404);
    const rows = await env.DB.prepare(
      `SELECT m.*, p.metadata FROM media m JOIN media_private p ON p.media_id=m.id WHERE m.album_id=? ORDER BY COALESCE(json_extract(p.metadata, '$.originalFilename'), m.id), m.id`,
    )
      .bind(id)
      .all<{
        id: string;
        source_sha256: string;
        width: number;
        height: number;
        capture_time: string | null;
        credit: string | null;
        copyright: string | null;
        usage_terms: string | null;
        rights_url: string | null;
        metadata: string;
        kind: "photo" | "video";
        duration: number | null;
        poster_sha256: string | null;
      }>();
    return json({
      id,
      team: { id: album.team_id, title: album.team_title },
      season: { id: album.season_id, title: album.season_title },
      title: album.title,
      date: album.date,
      visibility: album.visibility,
      state: album.state,
      shareToken: album.share_token,
      coverMediaId: album.cover_media_id,
      media: rows.results.map((m) => ({
        id: m.id,
        sha256: m.source_sha256,
        width: m.width,
        height: m.height,
        kind: m.kind,
        duration: m.duration,
        posterSha256: m.poster_sha256,
        captureTime: m.capture_time,
        credit: m.credit,
        copyright: m.copyright,
        usageTerms: m.usage_terms,
        rightsUrl: m.rights_url,
        privateMetadata: JSON.parse(m.metadata),
      })),
    });
  }
  if (request.method !== "PUT") return response("Method not allowed", 405);
  if (Number(request.headers.get("Content-Length")) > 2_000_000)
    return response("Body too large", 413);
  const bodyBytes = await readLimitedBody(request, 2_000_000);
  if (!bodyBytes) return response("Body too large", 413);
  const body = new TextDecoder().decode(bodyBytes);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return response("Invalid JSON", 400);
  }
  if (
    !object(value) ||
    !only(value, [
      "team",
      "season",
      "title",
      "date",
      "visibility",
      "state",
      "media",
      "coverMediaId",
    ]) ||
    !object(value.team) ||
    !only(value.team, ["id", "title"]) ||
    !validId(value.team.id) ||
    !text(value.team.title) ||
    !object(value.season) ||
    !only(value.season, ["id", "title"]) ||
    !validId(value.season.id) ||
    !text(value.season.title) ||
    !text(value.title) ||
    !validDate(value.date) ||
    !["public", "unlisted"].includes(value.visibility as string) ||
    !["draft", "published"].includes(value.state as string) ||
    !Array.isArray(value.media) ||
    value.media.length > 500 ||
    !value.media.every(validMedia) ||
    !(
      value.coverMediaId === undefined ||
      value.coverMediaId === null ||
      (typeof value.coverMediaId === "string" && uuid.test(value.coverMediaId))
    )
  )
    return response("Invalid album", 400);
  const items = value.media as Obj[];
  if (new Set(items.map((m) => m.id)).size !== items.length)
    return response("Duplicate media", 400);
  const existingAlbum = await env.DB.prepare(
    "SELECT team_id, season_id FROM albums WHERE id=?",
  )
    .bind(id)
    .first<{ team_id: string; season_id: string }>();
  if (
    existingAlbum &&
    (existingAlbum.team_id !== value.team.id ||
      existingAlbum.season_id !== value.season.id)
  )
    return response("Identity conflict", 409);
  for (const m of items) {
    const source = await env.MEDIA.head(
      `sources/${m.sha256}.${m.kind === "video" ? "mp4" : "jpg"}`,
    );
    if (!source) return response("Missing source", 409);
    const width = Number(source.customMetadata?.width);
    const height = Number(source.customMetadata?.height);
    // EXIF orientation may exchange the displayed axes. Both must still match
    // the source dimensions validated by Images, not arbitrary catalog values.
    if (
      !(
        (m.width === width && m.height === height) ||
        (m.width === height && m.height === width)
      )
    )
      return response("Source dimensions do not match validated asset", 409);
    if (m.kind === "video") {
      if (Number(source.customMetadata?.duration) !== m.duration)
        return response("Video duration does not match source", 409);
      const poster = await env.MEDIA.head(`sources/${m.posterSha256}.jpg`);
      if (!poster?.customMetadata?.width)
        return response("Missing validated video poster", 409);
    }
    const existing = await env.DB.prepare(
      "SELECT album_id, source_sha256 FROM media WHERE id=?",
    )
      .bind(m.id)
      .first<{ album_id: string; source_sha256: string }>();
    if (
      existing &&
      (existing.album_id !== id ||
        (existing.source_sha256 !== m.sha256 && m.replace !== true))
    )
      return response(
        "Media identity conflict or replacement not authorized",
        409,
      );
  }
  if (value.coverMediaId && !items.some((m) => m.id === value.coverMediaId)) {
    const cover = await env.DB.prepare(
      "SELECT id FROM media WHERE id=? AND album_id=?",
    )
      .bind(value.coverMediaId, id)
      .first();
    if (!cover) return response("Invalid cover", 400);
  }
  const statements = [
    env.DB.prepare(`INSERT INTO teams(id,title) SELECT NULL,NULL WHERE EXISTS
      (SELECT 1 FROM albums WHERE id=? AND (team_id<>? OR season_id<>?))`).bind(
      id,
      value.team.id,
      value.season.id,
    ),
    env.DB.prepare(
      "INSERT INTO teams(id,title) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title",
    ).bind(value.team.id, value.team.title),
    env.DB.prepare(
      "INSERT INTO seasons(id,team_id,title) VALUES(?,?,?) ON CONFLICT(team_id,id) DO UPDATE SET title=excluded.title",
    ).bind(value.season.id, value.team.id, value.season.title),
    env.DB.prepare(`INSERT INTO albums(id,team_id,season_id,title,date,visibility,state,share_token,cover_media_id) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,date=excluded.date,visibility=excluded.visibility,state=excluded.state,cover_media_id=excluded.cover_media_id WHERE team_id=excluded.team_id AND season_id=excluded.season_id`).bind(
      id,
      value.team.id,
      value.season.id,
      value.title,
      value.date,
      value.visibility,
      value.state,
      token(),
      value.coverMediaId ?? null,
    ),
  ];
  for (const m of items) {
    statements.push(
      env.DB.prepare(`INSERT INTO teams(id,title) SELECT NULL,NULL WHERE EXISTS
      (SELECT 1 FROM media WHERE id=? AND (album_id<>? OR (source_sha256<>? AND ?<>1)))`).bind(
        m.id,
        id,
        m.sha256,
        m.replace === true ? 1 : 0,
      ),
    );
    statements.push(
      env.DB.prepare(`INSERT INTO media(id,album_id,source_sha256,width,height,capture_time,credit,copyright,usage_terms,rights_url,kind,duration,poster_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET source_sha256=excluded.source_sha256,width=excluded.width,height=excluded.height,capture_time=excluded.capture_time,credit=excluded.credit,copyright=excluded.copyright,usage_terms=excluded.usage_terms,rights_url=excluded.rights_url,kind=excluded.kind,duration=excluded.duration,poster_sha256=excluded.poster_sha256
      WHERE album_id=excluded.album_id AND (source_sha256=excluded.source_sha256 OR ?=1)`).bind(
        m.id,
        id,
        m.sha256,
        m.width,
        m.height,
        m.captureTime === null
          ? null
          : new Date(m.captureTime as string).toISOString(),
        m.credit,
        m.copyright,
        m.usageTerms,
        m.rightsUrl,
        m.kind ?? "photo",
        m.duration ?? null,
        m.posterSha256 ?? null,
        m.replace === true ? 1 : 0,
      ),
    );
    statements.push(
      env.DB.prepare(
        "INSERT INTO media_private(media_id,metadata) VALUES(?,?) ON CONFLICT(media_id) DO UPDATE SET metadata=excluded.metadata",
      ).bind(m.id, JSON.stringify(m.privateMetadata)),
    );
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes("NOT NULL constraint failed: teams.title"))
      return response("Concurrent identity conflict", 409);
    throw error;
  }
  const saved = await env.DB.prepare(
    "SELECT share_token FROM albums WHERE id=?",
  )
    .bind(id)
    .first<{ share_token: string }>();
  return json({
    albumUrl:
      value.visibility === "public"
        ? `/albums/${id}`
        : `/shared/${saved?.share_token}`,
    previewUrl: `/preview/${id}`,
  });
}
