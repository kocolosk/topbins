import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { previewUrls } from "./preview-output.ts";

export function pendingMigrations(
  files: string[],
  applied: { name: string }[],
): string[] {
  const names = new Set(applied.map((row) => row.name));
  return files
    .filter((file) => file.endsWith(".sql") && !names.has(file))
    .sort();
}

export function previewContext(env: NodeJS.ProcessEnv): {
  branch: string;
  commit: string;
} {
  assert.equal(env.WORKERS_CI, "1", "Run this deployment in Workers Builds");
  const branch = env.WORKERS_CI_BRANCH;
  const commit = env.WORKERS_CI_COMMIT_SHA;
  assert.ok(
    branch && branch !== "main",
    "Only non-main branch Previews deploy",
  );
  assert.ok(
    commit && /^[a-f0-9]{40}$/.test(commit),
    "Missing build commit SHA",
  );
  return { branch, commit };
}

if (import.meta.main) {
  const { branch, commit } = previewContext(process.env);
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  assert.equal(head, commit, "Build checkout must match the triggering commit");
  const wrangler = fileURLToPath(
    new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
  );
  const runWrangler = (args: string[]) =>
    execFileSync(process.execPath, [wrangler, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 16 * 1024 * 1024,
    });

  // Builds may run in parallel across branches. Read staging migration state;
  // never race to mutate shared schema from individual Preview builds.
  const migrations = JSON.parse(
    runWrangler([
      "d1",
      "execute",
      "DB",
      "--remote",
      "--config",
      "wrangler.preview.jsonc",
      "--command",
      "SELECT name FROM d1_migrations",
      "--json",
    ]),
  );
  assert.equal(migrations.length, 1);
  assert.equal(migrations[0].success, true);
  const pending = pendingMigrations(
    readdirSync("migrations"),
    migrations[0].results,
  );
  assert.deepEqual(
    pending,
    [],
    `Apply staging migrations once, then retry this build: ${pending.join(", ")}`,
  );

  const output = runWrangler([
    "preview",
    "--config",
    "wrangler.preview.jsonc",
    "--name",
    branch,
    "--tag",
    commit,
    "--ignore-base-config",
    "--json",
  ]);
  console.log(output);
  const urls = previewUrls(output);
  execFileSync(
    process.execPath,
    ["scripts/check-preview.mjs", urls.deployment_url],
    {
      stdio: "inherit",
    },
  );
  console.log(`Branch Preview: ${urls.preview_url}`);
  console.log(`Immutable deployment: ${urls.deployment_url}`);
}
