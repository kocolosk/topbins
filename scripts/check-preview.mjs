import assert from "node:assert/strict";

const base = new URL(process.argv[2]);
assert.equal(base.protocol, "https:");

// Probe the immutable deployment, not an alias that another commit could move.
// Fetching the catalog exercises D1 as well as the Worker and static assets.
for (const [path, expected, options] of [
  ["/api/health", 200],
  ["/api/teams", 200],
  ["/", 200],
  ["/style.css", 200],
  ["/api/publisher/albums", 401, { method: "POST" }],
  ["/preview/nonexistent", 401],
]) {
  let response;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      response = await fetch(new URL(path, base), {
        ...options,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === expected) break;
    } catch (error) {
      if (attempt === 5) throw error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  assert.equal(response?.status, expected, `${path}: unexpected status`);
  if (path === "/api/health") {
    assert.deepEqual(await response.json(), { status: "ok" });
  }
  console.log(`${path}: ${expected}`);
}
