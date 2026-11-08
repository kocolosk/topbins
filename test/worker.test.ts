import { applyD1Migrations } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/worker";

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
