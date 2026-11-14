import { applyD1Migrations } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/worker";

describe("video transport and visibility", () => {
  const token = "synthetic-video-token";
  const secretEnv = { ...env, PUBLISH_TOKEN: token };
  const base = "https://example.test";
  const id = "77777777-7777-4777-8777-777777777777";
  const poster = "c".repeat(64);
  const bytes = new Uint8Array([
    0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115,
    111, 109, 109, 112, 52, 50,
  ]);
  const sha = async (data: Uint8Array) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  async function call(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return worker.fetch(
      new Request(base + path, { ...init, headers }),
      secretEnv,
    );
  }
  const payload = (hash: string, state: string) => ({
    team: { id: "video-team", title: "Video team" },
    season: { id: "fall-2026", title: "Fall 2026" },
    title: "A clip",
    date: "2026-10-10",
    visibility: "unlisted",
    state,
    media: [
      {
        id,
        kind: "video",
        sha256: hash,
        width: 80,
        height: 60,
        duration: 2,
        posterSha256: poster,
        captureTime: null,
        credit: null,
        copyright: null,
        usageTerms: null,
        rightsUrl: null,
        privateMetadata: { originalFilename: "private-camera-name.mp4" },
      },
    ],
  });
  const upload = (
    data: Uint8Array,
    hash: string,
    length: string = String(data.length),
  ) =>
    call(`/api/publisher/assets/${hash}?type=video/mp4`, {
      method: "PUT",
      body: data,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": length,
        "X-Video-Width": "80",
        "X-Video-Height": "60",
        "X-Video-Duration": "2",
      },
    });
  it("stages streaming uploads with size/digest checks and requires a poster before commit", async () => {
    const hash = await sha(bytes);
    expect((await upload(bytes, hash, "100000000")).status).toBe(413);
    expect((await upload(bytes, "d".repeat(64))).status).toBe(400);
    // The emulator can log "Network connection lost" when its internal R2 RPC
    // body is intentionally aborted; the app must still return 400 and clean up.
    const short = await upload(bytes.slice(0, 12), hash, "24");
    expect(short.status).toBe(400);
    expect(await env.MEDIA.head(`sources/${hash}.mp4`)).toBeNull();
    const invalid = new Uint8Array(24).fill(7);
    const invalidHash = await sha(invalid);
    expect((await upload(invalid, invalidHash)).status).toBe(400);
    expect(await env.MEDIA.head(`sources/${invalidHash}.mp4`)).toBeNull();
    expect(await env.MEDIA.head(`sources/${"d".repeat(64)}.mp4`)).toBeNull();
    expect((await env.MEDIA.list({ prefix: "staging/" })).objects).toHaveLength(
      0,
    );
    expect((await upload(bytes, hash)).status).toBe(200);
    const update = await call("/api/publisher/albums/video-match", {
      method: "PUT",
      body: JSON.stringify(payload(hash, "published")),
    });
    expect(update.status).toBe(409);
    expect((await call("/api/albums/video-match")).status).toBe(404);
  });
  it("streams published/unlisted and authenticated preview clips with correct conditional byte ranges", async () => {
    const hash = await sha(bytes);
    await env.MEDIA.put(
      `sources/${poster}.jpg`,
      new Uint8Array([255, 216, 255, 217]),
      { customMetadata: { width: "80", height: "60" } },
    );
    const write = (state: string) =>
      call("/api/publisher/albums/video-match", {
        method: "PUT",
        body: JSON.stringify(payload(hash, state)),
      });
    expect((await write("draft")).status).toBe(200);
    const path = `/media/${id}/${hash}/play`;
    expect((await call(path)).status).toBe(404);
    expect(
      (await worker.fetch(new Request(`${base}/preview${path}`), secretEnv))
        .status,
    ).toBe(401);
    const preview = await call(`/preview${path}`, {
      headers: { Range: "bytes=0-3" },
    });
    expect(preview.status).toBe(206);
    expect(preview.headers.get("Cache-Control")).toBe("no-store");
    expect((await write("published")).status).toBe(200);
    expect((await call("/api/albums/video-match")).status).toBe(404);
    const exported = (await (
      await call("/api/publisher/albums/video-match")
    ).json()) as { shareToken: string };
    const shared = await call(`/api/shared/${exported.shareToken}`);
    const dto = await shared.text();
    expect(dto).toContain('"kind":"video"');
    expect(dto).toContain('"duration":2');
    expect(dto).not.toContain("private-camera-name");
    const full = await call(path);
    expect(full.status).toBe(200);
    expect(full.headers.get("Content-Type")).toBe("video/mp4");
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
    const tag = full.headers.get("ETag") ?? "";
    const ranges: [string, number, number][] = [
      ["bytes=0-3", 0, 4],
      ["bytes=4-", 4, bytes.length - 4],
      ["bytes=-4", bytes.length - 4, 4],
      ["bytes=20-999", 20, 4],
    ];
    for (const [range, offset, length] of ranges) {
      const result = await call(path, { headers: { Range: range } });
      expect(result.status).toBe(206);
      expect(result.headers.get("Content-Range")).toBe(
        `bytes ${offset}-${offset + length - 1}/${bytes.length}`,
      );
      expect(new Uint8Array(await result.arrayBuffer())).toEqual(
        bytes.slice(offset, offset + length),
      );
    }
    for (const range of [
      "bytes=100-",
      "bytes=-0",
      "bytes=3-1",
      "bytes=0-1,3-4",
      "bytes=invalid",
    ]) {
      const result = await call(path, { headers: { Range: range } });
      expect(result.status).toBe(416);
      expect(result.headers.get("Content-Range")).toBe(
        `bytes */${bytes.length}`,
      );
    }
    expect(
      (await call(path, { headers: { "If-None-Match": tag } })).status,
    ).toBe(304);
    const modified = full.headers.get("Last-Modified") ?? "";
    const shifted = (seconds: number) =>
      new Date(Date.parse(modified) + seconds * 1000).toUTCString();
    for (const [validator, status] of [
      [tag, 206],
      [modified, 206],
      ['"stale"', 200],
      [shifted(-60), 200],
      [shifted(60), 200],
    ] as const) {
      const result = await call(path, {
        headers: { Range: "bytes=0-1", "If-Range": validator },
      });
      expect(result.status).toBe(status);
      expect((await result.arrayBuffer()).byteLength).toBe(
        status === 206 ? 2 : bytes.length,
      );
    }
    const head = await call(path, {
      method: "HEAD",
      headers: { Range: "bytes=0-1" },
    });
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get("Content-Length")).toBe(String(bytes.length));
    const download = await call(`/media/${id}/${hash}/download`);
    expect(download.headers.get("Content-Disposition")).toContain(".mp4");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
    expect((await write("draft")).status).toBe(200);
    expect((await call(path)).status).toBe(404);
  });
});

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("Worker scaffold", () => {
  it("serves only a minimal liveness response", async () => {
    const result = await exports.default.fetch(
      "https://example.test/api/health",
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: "ok" });
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("serves static assets through the Worker security boundary", async () => {
    const page = await exports.default.fetch("https://example.test/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Match galleries");
    expect(page.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    const css = await exports.default.fetch("https://example.test/style.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("Content-Type")).toContain("text/css");
  });

  it.each([
    "/api/albums",
    "/api/publisher",
    "/media/opaque-id",
    "/private",
    "/index.html",
    "/missing",
  ])(
    "does not expose unfinished route %s or use an SPA fallback",
    async (path) => {
      const result = await exports.default.fetch(`https://example.test${path}`);
      expect(result.status).toBe(404);
      expect(result.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it("rejects writes", async () => {
    const result = await exports.default.fetch("https://example.test/", {
      method: "POST",
    });
    expect(result.status).toBe(405);
    expect(result.headers.get("Allow")).toBe("GET, HEAD");
  });

  it.each(["/", "/api/health", "/missing"])(
    "supports HEAD without a response body for %s",
    async (path) => {
      const result = await exports.default.fetch(
        `https://example.test${path}`,
        {
          method: "HEAD",
        },
      );
      expect(await result.text()).toBe("");
    },
  );

  it("applies migrations to real local D1", async () => {
    const result = await env.DB.prepare("SELECT 1 AS connected").first();
    expect(result).toEqual({ connected: 1 });
  });

  it("can round-trip an opaque synthetic R2 object without exposing it", async () => {
    await env.MEDIA.put("test-only/v1/source.txt", "synthetic fixture");
    const object = await env.MEDIA.get("test-only/v1/source.txt");
    expect(await object?.text()).toBe("synthetic fixture");
    const result = await exports.default.fetch(
      "https://example.test/test-only/v1/source.txt",
    );
    expect(result.status).toBe(404);
    await env.MEDIA.delete("test-only/v1/source.txt");
  });

  it("has a managed Images binding (no hosted image storage)", () => {
    expect(typeof env.IMAGES.input).toBe("function");
  });
});

describe("publisher and visibility", () => {
  const secretEnv = { ...env, PUBLISH_TOKEN: "test-only-token" };
  const base = "https://example.test";
  const sha = "a".repeat(64);
  const otherSha = "b".repeat(64);
  const id = "11111111-1111-4111-8111-111111111111";
  const media = {
    id,
    sha256: sha,
    width: 100,
    height: 80,
    captureTime: null,
    credit: "Photographer",
    copyright: null,
    usageTerms: null,
    rightsUrl: null,
    privateMetadata: {
      keyword: "private-synthetic-keyword",
      filename: "secret.jpg",
    },
  };
  const album = {
    team: { id: "team", title: "Team" },
    season: { id: "season", title: "Season" },
    title: "Match",
    date: "2026-01-01",
    visibility: "public",
    state: "draft",
    media: [media],
  };
  async function call(path: string, init: RequestInit = {}, withToken = true) {
    const headers = new Headers(init.headers);
    if (withToken) headers.set("Authorization", "Bearer test-only-token");
    return worker.fetch(
      new Request(base + path, { ...init, headers }),
      secretEnv,
    );
  }
  async function put(value: unknown) {
    return call("/api/publisher/albums/match", {
      method: "PUT",
      body: JSON.stringify(value),
    });
  }
  it("fails closed without token and rejects bad authentication", async () => {
    const request = new Request(`${base}/api/publisher/albums/match`, {
      headers: { Authorization: "Bearer test-only-token" },
    });
    expect((await worker.fetch(request, env)).status).toBe(401);
    expect((await call("/api/publisher/albums/match", {}, false)).status).toBe(
      401,
    );
  });
  it("validates input and requires assets before any catalog changes", async () => {
    expect(
      (await call("/api/publisher/albums/match", { method: "PUT", body: "{" }))
        .status,
    ).toBe(400);
    expect((await put({ ...album, date: "2026-02-30" })).status).toBe(400);
    expect((await put(album)).status).toBe(409);
    expect((await call("/api/teams")).status).toBe(200);
    expect(await (await call("/api/teams")).json()).toEqual({ teams: [] });
    expect(
      (
        await call(`/api/publisher/assets/${sha}`, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: "not jpeg",
        })
      ).status,
    ).toBe(400);
  });
  it("uploads a synthetic JPEG with a verified digest", async () => {
    const encoded =
      "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIABAAEAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z";
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const upload = () =>
      call(`/api/publisher/assets/${digest}`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: bytes,
      });
    expect((await upload()).status).toBe(200);
    expect((await upload()).status).toBe(200);
    expect(
      (await call(`/api/publisher/assets/${digest}`, { method: "HEAD" }))
        .status,
    ).toBe(200);
    const imageId = "22222222-2222-4222-8222-222222222222";
    const write = (state: string) =>
      call("/api/publisher/albums/image-test", {
        method: "PUT",
        body: JSON.stringify({
          ...album,
          state,
          media: [
            { ...media, id: imageId, sha256: digest, width: 16, height: 16 },
          ],
        }),
      });
    expect((await write("published")).status).toBe(200);
    const imageUrl = `/media/${imageId}/${digest}/grid`;
    const transformed = await call(imageUrl, {
      headers: { Accept: "image/webp" },
    });
    expect(transformed.status).toBe(200);
    expect(transformed.headers.get("Content-Type")).toBe("image/webp");
    expect(transformed.headers.get("Cache-Control")).toBe("no-store");
    const imageBytes = await transformed.arrayBuffer();
    const cached = await worker.fetch(
      new Request(base + imageUrl, { headers: { Accept: "image/webp" } }),
      {
        ...secretEnv,
        IMAGES: new Proxy(env.IMAGES, {
          get(target, key, receiver) {
            if (key === "input")
              throw new Error("A cache hit must not retransform");
            return Reflect.get(target, key, receiver);
          },
        }),
      },
    );
    expect(cached.status).toBe(200);
    expect(await cached.arrayBuffer()).toEqual(imageBytes);
    // AVIF output is capped at 1,200 px, so the 2560 px viewer negotiates WebP
    // and is labeled by what was actually produced.
    const viewer = await call(`/media/${imageId}/${digest}/viewer`, {
      headers: { Accept: "image/avif,image/webp" },
    });
    expect(viewer.status).toBe(200);
    expect(viewer.headers.get("Content-Type")).toBe("image/webp");
    expect(viewer.headers.get("Vary")).toBe("Accept");
    expect((await write("draft")).status).toBe(200);
    expect((await call(imageUrl)).status).toBe(404);
  });
  it("gates drafts, publishes public and unlisted without private metadata, and retains media", async () => {
    await env.MEDIA.put(
      `sources/${sha}.jpg`,
      new Uint8Array([255, 216, 255, 217]),
      { customMetadata: { width: "100", height: "80" } },
    );
    expect((await put(album)).status).toBe(200);
    expect((await call("/api/albums/match")).status).toBe(404);
    expect((await call(`/media/${id}/${sha}/download`)).status).toBe(404);
    const exported = (await (
      await call("/api/publisher/albums/match")
    ).json()) as { shareToken: string; media: unknown[] };
    expect(JSON.stringify(exported)).toContain("private-synthetic-keyword");
    expect((await put({ ...album, state: "published" })).status).toBe(200);
    const publicResponse = await call("/api/albums/match");
    const publicText = await publicResponse.text();
    expect(publicText).toContain(id);
    expect(publicText).not.toContain("private-synthetic-keyword");
    expect(publicText).not.toContain("secret.jpg");
    expect(publicText).not.toContain(exported.shareToken);
    expect(
      (await call(`/media/${id}/${sha}/download`)).headers.get(
        "Content-Disposition",
      ),
    ).not.toContain("secret");
    expect(
      (
        await put({
          ...album,
          state: "published",
          visibility: "unlisted",
          media: [],
        })
      ).status,
    ).toBe(200);
    expect((await call("/api/albums/match")).status).toBe(404);
    expect(await (await call("/api/teams")).json()).toEqual({ teams: [] });
    const shared = await call(`/api/shared/${exported.shareToken}`);
    expect(shared.status).toBe(200);
    expect(shared.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(await shared.text()).toContain(id);
    expect((await call(`/media/${id}/${sha}/download`)).status).toBe(200);
    expect(
      (await call(`/media/${id}/${sha}/download`, { method: "HEAD" })).body,
    ).toBeNull();
    expect(
      (await put({ ...album, state: "published", visibility: "unlisted" }))
        .status,
    ).toBe(200);
    expect(
      (
        (await (await call("/api/publisher/albums/match")).json()) as {
          shareToken: string;
        }
      ).shareToken,
    ).toBe(exported.shareToken);
  });
  it("requires explicit replacement and rejects stale URLs", async () => {
    await env.MEDIA.put(
      `sources/${otherSha}.jpg`,
      new Uint8Array([255, 216, 255, 217]),
      { customMetadata: { width: "100", height: "80" } },
    );
    expect(
      (
        await put({
          ...album,
          state: "published",
          media: [{ ...media, sha256: otherSha }],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await put({
          ...album,
          state: "published",
          media: [{ ...media, sha256: otherSha, replace: true }],
        })
      ).status,
    ).toBe(200);
    expect((await call(`/media/${id}/${sha}/download`)).status).toBe(404);
    expect((await call(`/media/${id}/${otherSha}/download`)).status).toBe(200);
  });

  it("supports the same season slug under different teams", async () => {
    const result = await call("/api/publisher/albums/another-team-match", {
      method: "PUT",
      body: JSON.stringify({
        ...album,
        team: { id: "another-team", title: "Another team" },
        state: "published",
        media: [],
      }),
    });
    expect(result.status).toBe(200);
    expect(
      await (
        await call("/api/teams/another-team/seasons/season/albums")
      ).json(),
    ).toMatchObject({ albums: [{ id: "another-team-match" }] });
    expect(
      await (await call("/api/teams/team/seasons/season/albums")).text(),
    ).not.toContain("another-team-match");
  });

  it("authenticates draft pages and media without leaking private metadata", async () => {
    expect((await put(album)).status).toBe(409);
    expect(
      (
        await put({
          ...album,
          media: [{ ...media, sha256: otherSha }],
        })
      ).status,
    ).toBe(200);
    const denied = await call("/preview/match", {}, false);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("WWW-Authenticate")).toContain("Basic");
    const basic = {
      Authorization: `Basic ${btoa("publisher:test-only-token")}`,
    };
    const page = await worker.fetch(
      new Request(`${base}/preview/match`, { headers: basic }),
      secretEnv,
    );
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("Draft preview");
    expect(html).not.toContain("private-synthetic-keyword");
    expect(html).not.toContain("secret.jpg");
    expect((await call("/albums/match")).status).toBe(404);
    expect(
      (await call(`/preview/media/${id}/${otherSha}/download`, {}, false))
        .status,
    ).toBe(401);
    expect(
      (
        await worker.fetch(
          new Request(`${base}/preview/media/${id}/${otherSha}/download`, {
            headers: basic,
          }),
          secretEnv,
        )
      ).status,
    ).toBe(200);
  });

  it("bounds chunked requests without Content-Length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2_000_001));
        controller.close();
      },
    });
    expect(
      (await call("/api/publisher/albums/match", { method: "PUT", body }))
        .status,
    ).toBe(413);
  });

  it("rejects catalog dimensions that differ from the validated source", async () => {
    expect(
      (
        await put({
          ...album,
          media: [{ ...media, sha256: otherSha, width: 200 }],
        })
      ).status,
    ).toBe(409);
  });

  it("orders camera filenames lexicographically across bursts and conflicting timestamps", async () => {
    const earlier = "33333333-3333-4333-8333-333333333333";
    const later = "44444444-4444-4444-8444-444444444444";
    const unknown = "55555555-5555-4555-8555-555555555555";
    const burst = "66666666-6666-4666-8666-666666666666";
    const saved = await call("/api/publisher/albums/timed-match", {
      method: "PUT",
      body: JSON.stringify({
        ...album,
        state: "published",
        media: [
          {
            ...media,
            id: later,
            sha256: otherSha,
            captureTime: "2026-01-01T10:30:00Z",
            privateMetadata: { originalFilename: "9O0A0001.jpg" },
          },
          {
            ...media,
            id: earlier,
            sha256: otherSha,
            captureTime: "2026-01-01T12:00:00+02:00",
            privateMetadata: {
              originalFilename: "9O0A0002.jpg",
              captureTimeOriginal: "2026:01:01 12:00:00",
              captureOffsetOriginal: "+02:00",
            },
          },
          {
            ...media,
            id: unknown,
            sha256: otherSha,
            captureTime: null,
            privateMetadata: {
              originalFilename: "9O0A0003.jpg",
              captureTimeOriginal: "2026:01:01 13:00:00",
              captureOffsetOriginal: null,
            },
          },
          {
            ...media,
            id: burst,
            sha256: otherSha,
            captureTime: "2026-01-01T10:30:00Z",
            privateMetadata: { originalFilename: "9O0A0000.jpg" },
          },
        ],
      }),
    });
    expect(saved.status).toBe(200);
    const result = (await (await call("/api/albums/timed-match")).json()) as {
      album: { media: { id: string; captureTime: string | null }[] };
    };
    expect(result.album.media.map((item) => item.id)).toEqual([
      burst,
      later,
      earlier,
      unknown,
    ]);
    expect(result.album.media[2]?.captureTime).toBe(
      "2026-01-01T12:00:00+02:00",
    );
    expect(result.album.media[3]?.captureTime).toBe("2026-01-01T13:00:00");
    expect(JSON.stringify(result)).not.toContain("9O0A000");
    expect(JSON.stringify(result)).not.toContain("private-synthetic-keyword");
  });
});
