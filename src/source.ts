import { response } from "./http";

// Stream source bytes; never buffer an MP4 in Worker memory.
export async function serveSource(
  request: Request,
  bucket: R2Bucket,
  key: string,
  type: string,
  filename: string,
  attachment: boolean,
): Promise<Response> {
  const metadata = await bucket.head(key);
  if (!metadata) return response("Not found", 404);
  const etag = metadata.httpEtag;
  const modified = metadata.uploaded.toUTCString();
  const headers: Record<string, string> = {
    ETag: etag,
    "Last-Modified": modified,
    "Accept-Ranges": "bytes",
    "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${filename}"`,
  };
  const finish = (body: BodyInit | null, status: number) => {
    const result = response(body, status, type);
    for (const [name, value] of Object.entries(headers))
      result.headers.set(name, value);
    return result;
  };
  const noneMatch = request.headers.get("If-None-Match");
  if (
    noneMatch
      ?.split(",")
      .some(
        (value) =>
          value.trim() === "*" || value.trim().replace(/^W\//, "") === etag,
      ) ||
    (!noneMatch &&
      Date.parse(request.headers.get("If-Modified-Since") ?? "") >=
        Date.parse(modified))
  ) {
    return finish(null, 304);
  }
  let start = 0,
    length = metadata.size,
    partial = false;
  let range = request.method === "HEAD" ? null : request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  // Unlike If-Modified-Since, an If-Range date must match exactly (RFC 9110).
  if (
    ifRange &&
    ifRange !== etag &&
    Date.parse(ifRange) !== Date.parse(modified)
  )
    range = null;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let valid = !!match && !!(match[1] || match[2]);
    if (valid && match) {
      const first = Number(match[1]),
        last = Number(match[2]);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last))
        valid = false;
      else if (!match[1]) {
        if (last <= 0) valid = false;
        start = Math.max(0, metadata.size - last);
        length = metadata.size - start;
      } else {
        start = first;
        const end = match[2]
          ? Math.min(last, metadata.size - 1)
          : metadata.size - 1;
        length = end - start + 1;
      }
    }
    if (!valid || start >= metadata.size || length <= 0) {
      headers["Content-Range"] = `bytes */${metadata.size}`;
      return finish(null, 416);
    }
    partial = true;
    headers["Content-Range"] =
      `bytes ${start}-${start + length - 1}/${metadata.size}`;
  }
  headers["Content-Length"] = String(length);
  if (request.method === "HEAD") return finish(null, 200);
  const object = await bucket.get(
    key,
    partial ? { range: { offset: start, length } } : undefined,
  );
  if (!object) return response("Not found", 404);
  return finish(object.body, partial ? 206 : 200);
}
