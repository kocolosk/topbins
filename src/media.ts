import { response } from "./http";

export async function serveMedia(
  request: Request,
  env: Env,
  path: string,
  preview = false,
): Promise<Response> {
  const match =
    /^\/media\/([0-9a-f-]{36})\/([0-9a-f]{64})\/(grid|viewer|download)$/.exec(
      path,
    );
  if (!match) return response("Not found", 404);
  const row =
    await env.DB.prepare(`SELECT a.state, a.visibility FROM media m JOIN albums a ON a.id=m.album_id
    WHERE m.id=? AND m.source_sha256=?`)
      .bind(match[1], match[2])
      .first<{ state: string; visibility: string }>();
  if (!row || (!preview && row.state !== "published"))
    return response("Not found", 404);
  if (match[3] === "download") {
    const metadata = await env.MEDIA.head(`sources/${match[2]}.jpg`);
    if (!metadata) return response("Not found", 404);
    const etag = metadata.httpEtag;
    const matches = (request.headers.get("If-None-Match") ?? "")
      .split(",")
      .some(
        (value) =>
          value.trim() === "*" || value.trim().replace(/^W\//, "") === etag,
      );
    if (matches) {
      const result = response(null, 304, "image/jpeg");
      result.headers.set("ETag", etag);
      return result;
    }
    const object =
      request.method === "HEAD"
        ? null
        : await env.MEDIA.get(`sources/${match[2]}.jpg`);
    if (request.method !== "HEAD" && !object) return response("Not found", 404);
    const result = response(object?.body ?? null, 200, "image/jpeg");
    result.headers.set(
      "Content-Disposition",
      `attachment; filename="photo-${match[1]}.jpg"`,
    );
    result.headers.set("Content-Length", String(metadata.size));
    result.headers.set("ETag", etag);
    return result;
  }
  const accept = request.headers.get("Accept") ?? "";
  const accepts = (type: string) =>
    accept.split(",").some((part) => {
      const [name, ...params] = part.trim().toLowerCase().split(";");
      if (name?.trim() !== type) return false;
      const quality = params.find((param) => param.trim().startsWith("q="));
      return quality === undefined || Number(quality.trim().slice(2)) > 0;
    });
  const format = accepts("image/avif")
    ? "image/avif"
    : accepts("image/webp")
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
        .output({ format })
    ).response();
    if (!transformed.ok) return response("Image transformation failed", 502);
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
