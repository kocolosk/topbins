import {
  getPublicAlbum,
  getSharedAlbum,
  listAlbums,
  listSeasons,
  listTeams,
} from "./catalog";
import { json, response } from "./http";
import { serveMedia } from "./media";
import { publisher } from "./publisher";
import { handleSite } from "./site";

async function handle(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  let result: Response;
  if (pathname.startsWith("/api/publisher/"))
    result = await publisher(request, env, pathname);
  else if (request.method !== "GET" && request.method !== "HEAD") {
    result = response("Method not allowed", 405);
    result.headers.set("Allow", "GET, HEAD");
  } else if (pathname === "/api/health") result = json({ status: "ok" });
  else if (pathname === "/api/teams")
    result = json({ teams: await listTeams(env.DB) });
  else if (/^\/api\/teams\/[^/]+\/seasons$/.test(pathname)) {
    result = json({
      seasons: await listSeasons(env.DB, pathname.split("/")[3] ?? ""),
    });
  } else if (/^\/api\/teams\/[^/]+\/seasons\/[^/]+\/albums$/.test(pathname)) {
    const parts = pathname.split("/");
    result = json({
      albums: await listAlbums(env.DB, parts[3] ?? "", parts[5] ?? ""),
    });
  } else if (/^\/api\/albums\/[^/]+$/.test(pathname)) {
    const album = await getPublicAlbum(env.DB, pathname.split("/")[3] ?? "");
    result = album ? json({ album }) : response("Not found", 404);
  } else if (/^\/api\/shared\/[^/]+$/.test(pathname)) {
    const album = await getSharedAlbum(env.DB, pathname.split("/")[3] ?? "");
    result = album ? json({ album }) : response("Not found", 404);
  } else if (pathname.startsWith("/media/"))
    result = await serveMedia(request, env, pathname);
  else result = (await handleSite(request, env)) ?? response("Not found", 404);
  if (request.method === "HEAD")
    return new Response(null, {
      status: result.status,
      headers: result.headers,
    });
  return result;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      // Do not return database errors, private catalog data, or binding details.
      return response(
        request.method === "HEAD"
          ? null
          : error instanceof URIError
            ? "Invalid URL"
            : "Request failed",
        error instanceof URIError ? 400 : 500,
      );
    }
  },
} satisfies ExportedHandler<Env>;
