import {
  getPreviewAlbum,
  getPublicAlbum,
  getSharedAlbum,
  listAlbums,
  listSeasons,
  listTeams,
} from "./catalog";
import { serveMedia } from "./media";
import { albumPage, homePage, seasonPage, teamPage } from "./pages";

type SiteEnv = Env & { PUBLISH_TOKEN?: string };

function page(
  request: Request,
  body: string,
  status = 200,
  contentType = "text/html; charset=utf-8",
): Response {
  return new Response(request.method === "HEAD" ? null : body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self'; media-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function previewAuthorized(
  request: Request,
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  const authorization = request.headers.get("Authorization") ?? "";
  let supplied = "";
  if (authorization.startsWith("Bearer ")) {
    supplied = authorization.slice(7);
  } else if (authorization.startsWith("Basic ")) {
    try {
      const credentials = atob(authorization.slice(6));
      if (!credentials.startsWith("publisher:")) return false;
      supplied = credentials.slice("publisher:".length);
    } catch {
      return false;
    }
  }
  const encoder = new TextEncoder();
  const expected = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  const actual = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(supplied),
  );
  return crypto.subtle.timingSafeEqual(expected, actual);
}

export async function handleSite(
  request: Request,
  env: SiteEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const preview =
    path.startsWith("/preview/") || path.startsWith("/api/preview/");
  if (preview) {
    if (!(await previewAuthorized(request, env.PUBLISH_TOKEN))) {
      const result = page(
        request,
        "Publisher credentials required.",
        401,
        "text/plain; charset=utf-8",
      );
      result.headers.set(
        "WWW-Authenticate",
        'Basic realm="topbins publisher", charset="UTF-8"',
      );
      return result;
    }
    if (path.startsWith("/preview/media/")) {
      return serveMedia(request, env, path.slice("/preview".length), true);
    }
    const albumId = path.startsWith("/api/preview/")
      ? path.slice("/api/preview/".length)
      : path.slice("/preview/".length);
    const album = await getPreviewAlbum(env.DB, decodeURIComponent(albumId));
    if (!album) return page(request, "Not found", 404, "text/plain");
    if (path.startsWith("/api/preview/")) {
      return page(request, JSON.stringify({ album }), 200, "application/json");
    }
    return page(request, albumPage(album, url, true));
  }
  if (path === "/") {
    return page(request, homePage(await listTeams(env.DB)));
  }
  if (path === "/style.css" || path === "/gallery.js") {
    const asset = await env.ASSETS.fetch(request);
    return new Response(request.method === "HEAD" ? null : asset.body, {
      status: asset.status,
      headers: {
        "Content-Type":
          asset.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }
  const albumMatch = path.match(/^\/(albums|shared)\/([^/]+)$/);
  if (albumMatch) {
    const id = decodeURIComponent(albumMatch[2] ?? "");
    const album =
      albumMatch[1] === "albums"
        ? await getPublicAlbum(env.DB, id)
        : await getSharedAlbum(env.DB, id);
    return album
      ? page(request, albumPage(album, url))
      : page(request, "Not found", 404, "text/plain");
  }
  const teamMatch = path.match(/^\/teams\/([^/]+)(?:\/seasons\/([^/]+))?$/);
  if (!teamMatch) return null;
  const teamId = decodeURIComponent(teamMatch[1] ?? "");
  const team = (await listTeams(env.DB)).find((item) => item.id === teamId);
  if (!team) return page(request, "Not found", 404, "text/plain");
  const seasons = await listSeasons(env.DB, teamId);
  if (!teamMatch[2]) return page(request, teamPage(team, seasons));
  const seasonId = decodeURIComponent(teamMatch[2]);
  const season = seasons.find((item) => item.id === seasonId);
  if (!season) return page(request, "Not found", 404, "text/plain");
  return page(
    request,
    seasonPage(team, season, await listAlbums(env.DB, teamId, seasonId)),
  );
}
