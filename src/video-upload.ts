import { json, response } from "./http";

export async function uploadVideo(
  request: Request,
  env: Env,
  sha: string,
): Promise<Response> {
  const length = Number(request.headers.get("Content-Length"));
  if (!Number.isSafeInteger(length) || length < 12)
    return response("MP4 upload requires a valid Content-Length", 411);
  if (length >= 100_000_000)
    return response("MP4 must be under 100 MB; export a smaller web clip", 413);
  const width = Number(request.headers.get("X-Video-Width"));
  const height = Number(request.headers.get("X-Video-Height"));
  const duration = Number(request.headers.get("X-Video-Duration"));
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 12000 ||
    height > 12000 ||
    width * height > 100_000_000 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 86400
  )
    return response("Invalid video dimensions or duration", 400);
  const key = `sources/${sha}.mp4`;
  if (await env.MEDIA.head(key)) return json({ sha256: sha });
  if (!request.body) return response("Missing MP4 body", 400);
  const staging = `staging/${crypto.randomUUID()}.mp4`;
  try {
    // Preserve known stream length for R2, and digest without buffering the clip.
    const fixed = new FixedLengthStream(length);
    const digest = new crypto.DigestStream("SHA-256");
    const writer = digest.getWriter();
    const abort = new AbortController();
    const body = request.body;
    const hashed = digest.digest;
    // Hash in the same backpressured flow as storage. A tee with a faster digest
    // consumer could otherwise queue an entire video on the storage branch.
    let received = 0;
    let invalidLength = false;
    const pipeline = Promise.resolve()
      .then(() =>
        body
          .pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              async transform(chunk, controller) {
                received += chunk.byteLength;
                if (received > length) {
                  invalidLength = true;
                  throw new Error("MP4 body exceeds Content-Length");
                }
                await writer.write(chunk);
                controller.enqueue(chunk);
              },
              async flush() {
                if (received !== length) {
                  invalidLength = true;
                  throw new Error("Incomplete MP4 body");
                }
                await writer.close();
              },
            }),
          )
          .pipeTo(fixed.writable, { signal: abort.signal }),
      )
      .catch(async (error) => {
        await writer.abort(error).catch(() => {});
        throw error;
      });
    const stored = Promise.resolve()
      .then(() => env.MEDIA.put(staging, fixed.readable))
      .catch((error) => {
        abort.abort(error);
        throw error;
      });
    const results = await Promise.allSettled([pipeline, stored, hashed]);
    if (invalidLength)
      return response("Video upload incomplete or invalid", 400);
    if (results[1]?.status === "rejected")
      return response("Video storage temporarily unavailable", 503);
    if (results[0]?.status === "rejected" || results[2]?.status === "rejected")
      return response("Video upload incomplete or invalid", 400);
    const actual = Array.from(new Uint8Array(await hashed), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    if (actual !== sha) return response("SHA-256 mismatch", 400);
    const signature = await env.MEDIA.get(staging, {
      range: { offset: 0, length: 12 },
    });
    const bytes = signature
      ? new Uint8Array(await signature.arrayBuffer())
      : new Uint8Array();
    if (new TextDecoder().decode(bytes.slice(4, 8)) !== "ftyp")
      return response("Expected MP4 file", 400);
    const object = await env.MEDIA.get(staging);
    if (!object) return response("Video staging failed", 500);
    await env.MEDIA.put(key, object.body, {
      httpMetadata: { contentType: "video/mp4" },
      customMetadata: {
        width: String(width),
        height: String(height),
        duration: String(duration),
      },
    });
    return json({ sha256: sha });
  } catch {
    return response("Video storage temporarily unavailable", 503);
  } finally {
    await env.MEDIA.delete(staging);
  }
}
