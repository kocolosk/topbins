// Publisher/preview authentication.
//
// Production: Cloudflare Access sits in front of the publisher paths and the
// Worker independently verifies the signed Access JWT, so a request that
// bypasses Access (for example through a misconfigured hostname) is still
// rejected. Local development: a shared PUBLISH_TOKEN, used only when no Access
// configuration is present.
export type AuthEnv = Env & {
  PUBLISH_TOKEN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

const teamDomainPattern = /^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/;
const maxJwtLength = 8192;
const leewaySeconds = 30;
const keyTtlMs = 60 * 60 * 1000;
const refreshIntervalMs = 60 * 1000;

type Mode = "access" | "token";

// Any defined Access setting selects Access mode, even if empty or incomplete:
// a half-configured production Worker must fail closed rather than fall back to
// a shared token. Value validation happens in verifyAccessJwt.
export function authMode(env: AuthEnv): Mode {
  return env.ACCESS_TEAM_DOMAIN !== undefined || env.ACCESS_AUD !== undefined
    ? "access"
    : "token";
}

interface KeySet {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}
const keyCache = new Map<string, KeySet>();

function decode(part: string): Uint8Array<ArrayBuffer> {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function parseJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(decode(part)));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function fetchKeys(domain: string): Promise<KeySet | null> {
  try {
    const result = await fetch(`https://${domain}/cdn-cgi/access/certs`, {
      // workerd supports only "follow" and "manual"; a 3xx is not `ok` below.
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok) return null;
    const body = (await result.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) return null;
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys as (JsonWebKey & { kid?: string })[]) {
      if (jwk.kty !== "RSA" || typeof jwk.kid !== "string") continue;
      keys.set(
        jwk.kid,
        await crypto.subtle.importKey(
          "jwk",
          jwk,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        ),
      );
    }
    return { keys, fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

async function signingKey(
  domain: string,
  kid: string,
): Promise<CryptoKey | null> {
  const cached = keyCache.get(domain);
  const fresh = cached && Date.now() - cached.fetchedAt < keyTtlMs;
  const known = fresh ? cached.keys.get(kid) : undefined;
  if (known) return known;
  // Refetch for rotated keys, but not on every request with an unknown kid.
  if (cached && Date.now() - cached.fetchedAt < refreshIntervalMs) return null;
  const next = await fetchKeys(domain);
  if (!next) return null;
  keyCache.set(domain, next);
  return next.keys.get(kid) ?? null;
}

async function verifyAccessJwt(
  request: Request,
  env: AuthEnv,
): Promise<boolean> {
  const domain = env.ACCESS_TEAM_DOMAIN?.toLowerCase();
  const audience = env.ACCESS_AUD;
  if (!domain || !audience || !teamDomainPattern.test(domain)) return false;
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt || jwt.length > maxJwtLength) return false;
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  const [head, body, signature] = parts as [string, string, string];
  try {
    const header = parseJson(head);
    const claims = parseJson(body);
    if (!header || !claims) return false;
    if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
    if (claims.iss !== `https://${domain}`) return false;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(audience)) return false;
    const now = Date.now() / 1000;
    if (typeof claims.exp !== "number" || claims.exp + leewaySeconds < now)
      return false;
    if (claims.nbf !== undefined) {
      if (typeof claims.nbf !== "number" || claims.nbf - leewaySeconds > now)
        return false;
    }
    const key = await signingKey(domain, header.kid);
    if (!key) return false;
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decode(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
  } catch {
    return false;
  }
}

async function tokenMatches(
  expected: string,
  supplied: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const a = await crypto.subtle.digest("SHA-256", encoder.encode(expected));
  const b = await crypto.subtle.digest("SHA-256", encoder.encode(supplied));
  return crypto.subtle.timingSafeEqual(a, b);
}

// `basic` additionally accepts username `publisher` with the token as password,
// for browser preview in local token mode only.
export async function publisherAuthorized(
  request: Request,
  env: AuthEnv,
  basic = false,
): Promise<boolean> {
  if (authMode(env) === "access") return verifyAccessJwt(request, env);
  const expected = env.PUBLISH_TOKEN;
  if (!expected) return false;
  const authorization = request.headers.get("Authorization") ?? "";
  if (authorization.startsWith("Bearer "))
    return tokenMatches(expected, authorization.slice(7));
  if (basic && authorization.startsWith("Basic ")) {
    try {
      const credentials = atob(authorization.slice(6));
      if (!credentials.startsWith("publisher:")) return false;
      return tokenMatches(expected, credentials.slice("publisher:".length));
    } catch {
      return false;
    }
  }
  return false;
}
