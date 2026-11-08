import assert from "node:assert/strict";

export function previewUrls(output: string): {
  preview_url: string;
  deployment_url: string;
} {
  // Wrangler 4.158.0 prints asset-upload progress even with --json. Its final
  // payload starts on a new line; progress must not be treated as JSON.
  const start = output.search(/^\{\r?\n\s+"preview":/m);
  assert.ok(start >= 0, "Wrangler did not return a Preview JSON payload");
  const result = JSON.parse(output.slice(start));
  const urls = {
    preview_url: result.preview?.urls?.[0],
    deployment_url: result.deployment?.urls?.[0],
  };
  for (const value of Object.values(urls)) {
    assert.equal(typeof value, "string", "Missing Cloudflare Preview URL");
    const url = new URL(value);
    assert.equal(url.protocol, "https:");
    assert.ok(url.hostname.endsWith(".workers.dev"));
    assert.equal(url.origin, value, "Preview URL must be a canonical origin");
  }
  return urls;
}
