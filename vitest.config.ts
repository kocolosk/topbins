import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(
                  fileURLToPath(new URL("./migrations", import.meta.url)),
                ),
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["test/worker.test.ts"],
        },
      },
      {
        test: {
          name: "cli",
          environment: "node",
          include: ["test/cli.test.ts"],
        },
      },
    ],
  },
});
