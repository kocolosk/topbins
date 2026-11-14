import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/worker";

const domain = "synthetic-team.cloudflareaccess.com";
const aud = "a".repeat(64);
const base = "https://example.test";
const accessEnv = { ...env, ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: aud };

const b64 = (data: ArrayBuffer | string) => {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

let signer: CryptoKey;
let otherSigner: CryptoKey;
let publicJwk: JsonWebKey & { kid: string };
let jwksFetches = 0;

async function keyPair() {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;
}

async function jwt(
  claims: Record<string, unknown> = {},
  options: { key?: CryptoKey; kid?: string; alg?: string } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(
    JSON.stringify({
      alg: options.alg ?? "RS256",
      kid: options.kid ?? "key-1",
      typ: "JWT",
    }),
  );
  const body = b64(
    JSON.stringify({
      iss: `https://${domain}`,
      aud: [aud],
      iat: now,
      exp: now + 3600,
      common_name: "synthetic-service-token.access",
      ...claims,
    }),
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    options.key ?? signer,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64(signature)}`;
}

const publisherCall = (headers: Record<string, string>, e: Env = accessEnv) =>
  worker.fetch(
    new Request(`${base}/api/publisher/assets/${"0".repeat(64)}`, {
      method: "GET",
      headers,
    }),
    e,
  );

describe("Cloudflare Access authentication", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    const pair = await keyPair();
    signer = pair.privateKey;
    otherSigner = (await keyPair()).privateKey;
    publicJwk = {
      ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey),
      kid: "key-1",
    };
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        // workerd rejects redirect: "error"; the stub must not hide that.
        if (
          init?.redirect !== undefined &&
          !["follow", "manual"].includes(init.redirect)
        )
          throw new TypeError("Invalid redirect value");
        if (String(input) === `https://${domain}/cdn-cgi/access/certs`) {
          jwksFetches++;
          return Response.json({ keys: [publicJwk] });
        }
        throw new Error(`unexpected fetch ${String(input)}`);
      },
    );
  });
  afterEach(() => undefined);

  it("accepts a valid Access JWT and caches the signing keys", async () => {
    const before = jwksFetches;
    const first = await publisherCall({
      "Cf-Access-Jwt-Assertion": await jwt(),
    });
    expect(first.status).toBe(404); // authorized; asset does not exist
    const second = await publisherCall({
      "Cf-Access-Jwt-Assertion": await jwt(),
    });
    expect(second.status).toBe(404);
    expect(jwksFetches - before).toBeLessThanOrEqual(1);
  });

  it("rejects missing, malformed, forged, expired and mis-scoped JWTs", async () => {
    const rejected: Record<string, string>[] = [
      {},
      { "Cf-Access-Jwt-Assertion": "not.a.jwt" },
      { "Cf-Access-Jwt-Assertion": "x".repeat(9000) },
      { "Cf-Access-Jwt-Assertion": await jwt({}, { key: otherSigner }) },
      { "Cf-Access-Jwt-Assertion": await jwt({}, { alg: "none" }) },
      { "Cf-Access-Jwt-Assertion": await jwt({}, { kid: "unknown" }) },
      { "Cf-Access-Jwt-Assertion": await jwt({ aud: ["b".repeat(64)] }) },
      { "Cf-Access-Jwt-Assertion": await jwt({ aud: undefined }) },
      { "Cf-Access-Jwt-Assertion": await jwt({ iss: "https://evil.test" }) },
      {
        "Cf-Access-Jwt-Assertion": await jwt({
          exp: Math.floor(Date.now() / 1000) - 3600,
        }),
      },
      { "Cf-Access-Jwt-Assertion": await jwt({ exp: undefined }) },
      {
        "Cf-Access-Jwt-Assertion": await jwt({
          nbf: Math.floor(Date.now() / 1000) + 3600,
        }),
      },
    ];
    for (const headers of rejected)
      expect((await publisherCall(headers)).status).toBe(401);
    // Tamper with the payload after signing.
    const [h, , s] = (await jwt()).split(".");
    const forged = `${h}.${b64(JSON.stringify({ iss: `https://${domain}`, aud: [aud], exp: 9999999999 }))}.${s}`;
    expect(
      (await publisherCall({ "Cf-Access-Jwt-Assertion": forged })).status,
    ).toBe(401);
  });

  it("ignores the shared token once Access is configured", async () => {
    const withToken = { ...accessEnv, PUBLISH_TOKEN: "synthetic-token" };
    const result = await publisherCall(
      { Authorization: "Bearer synthetic-token" },
      withToken,
    );
    expect(result.status).toBe(401);
  });

  it("fails closed on partial or invalid Access configuration", async () => {
    const headers = {
      "Cf-Access-Jwt-Assertion": await jwt(),
      Authorization: "Bearer synthetic-token",
    };
    for (const partial of [
      { ...env, PUBLISH_TOKEN: "synthetic-token", ACCESS_TEAM_DOMAIN: domain },
      { ...env, PUBLISH_TOKEN: "synthetic-token", ACCESS_AUD: aud },
      { ...accessEnv, ACCESS_TEAM_DOMAIN: "evil.test" },
    ])
      expect((await publisherCall(headers, partial)).status).toBe(401);
  });

  it("keeps the shared token for local use when Access is not configured", async () => {
    const local = { ...env, PUBLISH_TOKEN: "synthetic-token" };
    expect(
      (await publisherCall({ Authorization: "Bearer synthetic-token" }, local))
        .status,
    ).toBe(404);
    expect(
      (await publisherCall({ "Cf-Access-Jwt-Assertion": await jwt() }, local))
        .status,
    ).toBe(401);
  });

  it("protects preview with the JWT without prompting for a password", async () => {
    const denied = await worker.fetch(
      new Request(`${base}/preview/some-album`),
      accessEnv,
    );
    expect(denied.status).toBe(401);
    expect(denied.headers.get("WWW-Authenticate")).toBeNull();
    const api = await worker.fetch(
      new Request(`${base}/api/preview/some-album`, {
        headers: { Authorization: `Basic ${btoa("publisher:x")}` },
      }),
      accessEnv,
    );
    expect(api.status).toBe(401);
    const allowed = await worker.fetch(
      new Request(`${base}/preview/some-album`, {
        headers: { "Cf-Access-Jwt-Assertion": await jwt() },
      }),
      accessEnv,
    );
    expect(allowed.status).toBe(404); // authenticated; album does not exist
  });

  it("does not leak details when the key endpoint is unavailable", async () => {
    const unavailable = {
      ...accessEnv,
      ACCESS_TEAM_DOMAIN: "down.cloudflareaccess.com",
    };
    const claims = { iss: "https://down.cloudflareaccess.com" };
    const result = await publisherCall(
      { "Cf-Access-Jwt-Assertion": await jwt(claims) },
      unavailable,
    );
    expect(result.status).toBe(401);
    expect(await result.text()).toBe("Unauthorized");
  });
});
