import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  pendingMigrations,
  previewContext,
} from "../scripts/deploy-preview.ts";
import { previewUrls } from "../scripts/preview-output.ts";

const local = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
const preview = JSON.parse(readFileSync("wrangler.preview.jsonc", "utf8"));

describe("Cloudflare mise configuration isolation", () => {
  it("excludes global, system and ancestor tools for task and exec commands", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "topbins-mise-")));
    const project = join(root, "repo");
    const globalConfig = join(root, "config.toml");
    const systemConfig = join(root, "system.toml");
    const mise = process.env.MISE_BIN || "mise";
    const scope = resolve("scripts/cloudflare-env.sh");
    mkdirSync(project);
    writeFileSync(join(root, ".tool-versions"), "hugo extended_0.147.7\n");
    writeFileSync(globalConfig, '[tools]\nruby = "3.4.11"\n');
    writeFileSync(systemConfig, '[tools]\ngo = "1.27.3"\n');
    writeFileSync(
      join(project, "mise.toml"),
      '[tools]\nnode = "24.15.0"\n[tasks.probe]\nrun = "node --version"\n',
    );
    const env = {
      ...process.env,
      MISE_CONFIG_DIR: root,
      MISE_GLOBAL_CONFIG_FILE: globalConfig,
      MISE_SYSTEM_CONFIG_FILE: systemConfig,
      MISE_CEILING_PATHS: dirname(root),
      MISE_TRUSTED_CONFIG_PATHS: root,
    };
    const options = { cwd: project, env, encoding: "utf8" as const };
    try {
      // Prove the fixture models the inherited build-image configuration.
      const inherited = JSON.parse(
        execFileSync(mise, ["config", "ls", "--json"], options),
      );
      expect(
        inherited.some((config: { tools: string[] }) =>
          config.tools.includes("hugo"),
        ),
      ).toBe(true);
      const scoped = (args: string[]) =>
        execFileSync(
          "sh",
          ["-c", '. "$1"; shift; exec "$@"', "scope", scope, mise, ...args],
          options,
        );
      const configs = JSON.parse(scoped(["config", "ls", "--json"]));
      expect(configs).toHaveLength(1);
      expect(configs[0].path).toBe(join(project, "mise.toml"));
      expect(configs[0].tools).toEqual(["node"]);
      // Neither command may attempt to install the deliberately broken Hugo.
      expect(scoped(["run", "probe"]).trim()).toBe("v24.15.0");
      expect(scoped(["exec", "--", "node", "--version"]).trim()).toBe(
        "v24.15.0",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("PR preview deployment boundary", () => {
  it("keeps local development credential-free and remote bindings disabled", () => {
    expect(local.account_id).toBeUndefined();
    expect(local.previews).toBeUndefined();
    expect(local.workers_dev).toBe(false);
    expect(local.preview_urls).toBe(false);
    expect(local.d1_databases[0].remote).toBe(false);
    expect(local.r2_buckets[0].remote).toBe(false);
  });

  it("uses a separate preview parent with no production hostname", () => {
    expect(preview.name).toBe("topbins-preview");
    expect(preview.workers_dev).toBe(false);
    expect(preview.preview_urls).toBe(true);
    expect(preview.routes).toBeUndefined();
    expect(preview.route).toBeUndefined();
  });

  it("bundles the same app and assets as local development", () => {
    expect(preview.main).toBe(local.main);
    expect(preview.compatibility_date).toBe(local.compatibility_date);
    expect(preview.compatibility_flags).toEqual(local.compatibility_flags);
    expect(preview.assets).toEqual(local.assets);
  });

  it("migrates exactly the shared staging database used by previews", () => {
    expect(preview.d1_databases).toEqual(preview.previews.d1_databases);
    expect(preview.previews.d1_databases).toEqual([
      {
        binding: "DB",
        database_name: "topbins-staging-db",
        database_id: "97ca691a-1ffc-440d-994a-04ea078c800b",
        migrations_dir: "migrations",
        remote: false,
      },
    ]);
    expect(preview.previews.r2_buckets).toEqual([
      {
        binding: "MEDIA",
        bucket_name: "topbins-staging-media",
        remote: false,
      },
    ]);
    expect(preview.previews.images).toEqual(local.images);
  });

  it("explicitly disables publisher and draft-preview authentication", () => {
    // An explicit empty plain-text binding also replaces a previously configured
    // PUBLISH_TOKEN secret, rather than inheriting it on subsequent deployments.
    expect(preview.previews.vars).toEqual({ PUBLISH_TOKEN: "" });
  });
});

describe("Wrangler Preview output", () => {
  const result = {
    preview: {
      urls: ["https://feature-gallery-topbins-preview.example.workers.dev"],
    },
    deployment: {
      urls: ["https://12345678-topbins-preview.example.workers.dev"],
    },
  };

  it("reads URLs with and without asset-upload progress", () => {
    const json = JSON.stringify(result, null, 2);
    const expected = {
      preview_url: result.preview.urls[0],
      deployment_url: result.deployment.urls[0],
    };
    expect(previewUrls(json)).toEqual(expected);
    expect(
      previewUrls(`🌀 Building list of assets...\n+ /style.css\n\n${json}\n`),
    ).toEqual(expected);
  });

  it("fails rather than reporting missing or inactive URLs as success", () => {
    expect(() => previewUrls("Asset upload failed")).toThrow();
    expect(() =>
      previewUrls(JSON.stringify({ preview: { urls: [] } }, null, 2)),
    ).toThrow();
  });

  it("rejects malformed deployment URLs", () => {
    for (const value of [
      "http://example.workers.dev",
      "https://example.test",
      "https://example.workers.dev/\nINJECTED=true",
    ]) {
      expect(() =>
        previewUrls(
          JSON.stringify({ ...result, preview: { urls: [value] } }, null, 2),
        ),
      ).toThrow();
    }
  });
});

describe("Workers Builds deployment gate", () => {
  const env = {
    WORKERS_CI: "1",
    WORKERS_CI_BRANCH: "feature/gallery",
    WORKERS_CI_COMMIT_SHA: "a".repeat(40),
  };

  it("preserves the source branch name and exact commit", () => {
    expect(previewContext(env)).toEqual({
      branch: "feature/gallery",
      commit: "a".repeat(40),
    });
  });

  it("refuses production, local, and incomplete build contexts", () => {
    for (const context of [
      { ...env, WORKERS_CI_BRANCH: "main" },
      { ...env, WORKERS_CI: undefined },
      { ...env, WORKERS_CI_BRANCH: undefined },
      { ...env, WORKERS_CI_COMMIT_SHA: "not-a-commit" },
    ]) {
      expect(() => previewContext(context)).toThrow();
    }
  });

  it("requires unapplied staging migrations but tolerates newer shared schema", () => {
    expect(
      pendingMigrations(
        ["0002_catalog.sql", "README.md", "0001_baseline.sql"],
        [{ name: "0001_baseline.sql" }],
      ),
    ).toEqual(["0002_catalog.sql"]);
    expect(
      pendingMigrations(
        ["0001_baseline.sql"],
        [{ name: "0001_baseline.sql" }, { name: "0002_catalog.sql" }],
      ),
    ).toEqual([]);
  });
});
