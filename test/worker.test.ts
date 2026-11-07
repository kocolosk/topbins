import { applyD1Migrations } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

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
    expect(await page.text()).toContain("development scaffold");
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
