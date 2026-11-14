import { response } from "./http";
import { serveSource } from "./source";

// Explicit quality: the binding's default WebP output was lossless (several MB).
// Tuned on real exports (SSIM and 2x crops vs. the Lanczos-resized source).
const quality = {
  "image/jpeg": 82,
  "image/webp": 80,
  "image/avif": 65,
} as const;

export async function serveMedia(
  request: Request,
  env: Env,
  path: string,
  preview = false,
): Promise<Response> {
  const match =
    /^\/media\/([0-9a-f-]{36})\/([0-9a-f]{64})\/(grid|viewer|download|play)$/.exec(
      path,
    );
  if (!match) return response("Not found", 404);
  const row =
    await env.DB.prepare(`SELECT a.state, a.visibility, m.kind, m.source_sha256, m.poster_sha256
    FROM media m JOIN albums a ON a.id=m.album_id
    WHERE m.id=? AND (m.source_sha256=? OR (m.kind='video' AND m.poster_sha256=?))`)
      .bind(match[1], match[2], match[2])
      .first<{
        state: string;
        visibility: string;
        kind: string;
        source_sha256: string;
        poster_sha256: string | null;
      }>();
  if (!row || (!preview && row.state !== "published"))
    return response("Not found", 404);
  const video = row.kind === "video";
  if (match[3] === "download" || match[3] === "play") {
    if (match[2] !== row.source_sha256 || (!video && match[3] === "play"))
      return response("Not found", 404);
    return serveSource(
      request,
      env.MEDIA,
      `sources/${match[2]}.${video ? "mp4" : "jpg"}`,
      video ? "video/mp4" : "image/jpeg",
      `${video ? "video" : "photo"}-${match[1]}.${video ? "mp4" : "jpg"}`,
      match[3] === "download",
    );
  }
  if (video && match[2] !== row.poster_sha256)
    return response("Not found", 404);
  const accept = request.headers.get("Accept") ?? "";
  const accepts = (type: string) =>
    accept.split(",").some((part) => {
      const [name, ...params] = part.trim().toLowerCase().split(";");
      if (name?.trim() !== type) return false;
      const quality = params.find((param) => param.trim().startsWith("q="));
      return quality === undefined || Number(quality.trim().slice(2)) > 0;
    });
  // AVIF output is limited to 1,200 px per side, so the 2560 px viewer preset
  // can only ever fall back to WebP; negotiate WebP for it up front.
  const format =
    accepts("image/avif") && match[3] === "grid"
      ? "image/avif"
      : accepts("image/avif") || accepts("image/webp")
        ? "image/webp"
        : "image/jpeg";
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = `/__image-cache/${match[1]}/${match[2]}/${match[3]}/${format.slice(6)}`;
  cacheUrl.search = "";
  const cacheKey = new Request(cacheUrl, { method: "GET" });
  // Eligibility is always checked above, even on an internal cache hit.
  // The outward response remains no-store to avoid stale visibility in browsers.
  if (!preview) {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const result = response(
        request.method === "HEAD" ? null : cached.body,
        200,
        format,
      );
      result.headers.set("Vary", "Accept");
      return result;
    }
  }
  if (request.method === "HEAD") {
    const result = response(null, 200, format);
    result.headers.set("Vary", "Accept");
    return result;
  }
  const object = await env.MEDIA.get(`sources/${match[2]}.jpg`);
  if (!object) return response("Not found", 404);
  try {
    const size = match[3] === "grid" ? 640 : 2560;
    const transformed = (
      await env.IMAGES.input(object.body)
        .transform({ width: size, height: size, fit: "scale-down" })
        .output({
          format,
          quality: quality[format],
        })
    ).response();
    if (!transformed.ok) return response("Image transformation failed", 502);
    // Label by what was actually produced, never by what was requested.
    const actual = transformed.headers.get("Content-Type")?.split(";")[0];
    if (actual !== format) return response("Image transformation failed", 502);
    const result = response(
      request.method === "HEAD" ? null : transformed.body,
      200,
      format,
    );
    result.headers.set("Vary", "Accept");
    if (!preview) {
      const cacheEntry = new Response(result.clone().body, {
        headers: {
          "Content-Type": format,
          "Cache-Control": "public, max-age=86400",
        },
      });
      await caches.default.put(cacheKey, cacheEntry);
    }
    return result;
  } catch {
    return response("Image transformation failed", 502);
  }
}
