function response(
  body: BodyInit | null,
  status: number,
  contentType = "text/plain; charset=utf-8",
): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      const result = response("Method not allowed", 405);
      result.headers.set("Allow", "GET, HEAD");
      return result;
    }

    if (pathname === "/api/health") {
      // Liveness only: never expose credentials, catalog data, or resource names.
      return response(
        request.method === "HEAD" ? null : JSON.stringify({ status: "ok" }),
        200,
        "application/json",
      );
    }

    // Explicit allowlist: no SPA fallback or generic R2/file proxy.
    // All future gallery/media/publisher routes must enforce SPEC.md visibility.
    if (pathname === "/" || pathname === "/style.css") {
      const asset = await env.ASSETS.fetch(request);
      const result = response(
        request.method === "HEAD" ? null : asset.body,
        asset.status,
        asset.headers.get("Content-Type") ?? "application/octet-stream",
      );
      return result;
    }

    return response(request.method === "HEAD" ? null : "Not found", 404);
  },
} satisfies ExportedHandler<Env>;
