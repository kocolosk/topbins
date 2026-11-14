import { spawn, spawnSync } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importFolder } from "./import.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".wrangler", "demo");
const exportsDir = join(dir, "exports");
const configPath = join(dir, "wrangler.json");
const manifestPath = join(dir, "match.json");
const port = 8790;
const origin = `http://127.0.0.1:${port}`;
// Intentionally non-secret: this environment contains generated demo media only,
// binds loopback, has isolated local storage and cannot publish remotely.
const demoToken = "synthetic-demo-only";
const smoke = process.argv.slice(2);
if (smoke.some((arg) => arg !== "--smoke") || smoke.length > 1)
  throw new Error("Usage: npm run demo [-- --smoke]");

function command(tool: string, args: string[]) {
  const result = spawnSync(tool, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, CI: "true" },
  });
  if (result.status !== 0 || result.error)
    throw new Error(
      `${tool} failed: ${result.stderr || "run mise exec -- npm run doctor"}`,
    );
}
await mkdir(dir, { recursive: true, mode: 0o700 });
const lockPath = join(dir, "run.lock");
const lock = await open(lockPath, "wx", 0o600).catch(() => {
  throw new Error(
    "Demo already running or stale .wrangler/demo/run.lock. Remove it only after confirming no demo is active.",
  );
});
try {
  const portCheck = createServer();
  await new Promise<void>((resolve, reject) => {
    portCheck.once("error", () =>
      reject(
        new Error(
          `Demo port ${port} is in use; stop that server before starting the demo.`,
        ),
      ),
    );
    portCheck.listen(port, "127.0.0.1", () => portCheck.close(() => resolve()));
  });
  await mkdir(exportsDir, { recursive: true, mode: 0o700 });
  for (const [index, color] of ["royalblue", "seagreen"].entries()) {
    const name = join(exportsDir, `000${index + 1}.jpg`);
    command("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=1200x800`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      name,
    ]);
    command("exiftool", [
      "-overwrite_original",
      "-DateTimeOriginal=2026:10:10 12:00:00",
      "-OffsetTimeOriginal=-04:00",
      "-IPTC:Keywords=synthetic-private-keyword",
      "-XMP-dc:Creator=Demo photographer",
      name,
    ]);
  }
  command("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-metadata",
    "creation_time=2026-10-10T16:01:00Z",
    "-metadata",
    "location=+10.0000+010.0000/",
    join(exportsDir, "0003.mp4"),
  ]);
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        id: "demo-match",
        team: { id: "demo-team", title: "Demo team" },
        season: { id: "fall-2026", title: "Fall 2026" },
        title: "A match at the touchline",
        date: "2026-10-10",
        visibility: "public",
        defaults: { credit: "Demo photographer" },
        files: [
          { file: "0001.jpg" },
          { file: "0002.jpg" },
          { file: "0003.mp4", posterTime: 0.5 },
        ],
      },
      null,
      2,
    ),
  );
  const local = JSON.parse(
    await readFile(join(root, "wrangler.jsonc"), "utf8"),
  );
  await writeFile(
    configPath,
    JSON.stringify(
      {
        name: "topbins-demo",
        main: join(root, local.main),
        compatibility_date: local.compatibility_date,
        workers_dev: false,
        preview_urls: false,
        assets: {
          ...local.assets,
          directory: join(root, local.assets.directory),
        },
        d1_databases: [
          {
            binding: "DB",
            database_name: "topbins-demo",
            database_id: "00000000-0000-0000-0000-000000000000",
            migrations_dir: join(root, "migrations"),
            remote: false,
          },
        ],
        r2_buckets: [
          { binding: "MEDIA", bucket_name: "topbins-demo", remote: false },
        ],
        images: { binding: "IMAGES", remote: false },
        vars: { PUBLISH_TOKEN: demoToken },
      },
      null,
      2,
    ),
  );
  const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  const persist = join(dir, "state");
  command(process.execPath, [
    wrangler,
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    persist,
  ]);
  const server = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--local",
      "--config",
      configPath,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--persist-to",
      persist,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  server.stdout.on("data", (data) => {
    output += data.toString();
  });
  server.stderr.on("data", (data) => {
    output += data.toString();
  });
  const previous = process.env.TOPBINS_PUBLISH_TOKEN;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null)
        throw new Error(`Demo server failed:\n${output}`);
      try {
        const result = await fetch(`${origin}/api/health`, {
          signal: AbortSignal.timeout(500),
        });
        if (result.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Wait only for this local development server. */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error(`Demo server did not start:\n${output}`);
    process.env.TOPBINS_PUBLISH_TOKEN = demoToken;
    await importFolder(exportsDir, manifestPath, origin, true, true);
    const result = await fetch(`${origin}/api/albums/demo-match`);
    const album = (await result.json()) as {
      album: {
        media: { kind: string; viewerUrl: string; downloadUrl: string }[];
      };
    };
    if (
      !result.ok ||
      album.album.media.length !== 3 ||
      album.album.media[2]?.kind !== "video"
    )
      throw new Error("Mixed demo album failed.");
    const clip = album.album.media[2];
    const range = await fetch(origin + clip.viewerUrl, {
      headers: { Range: "bytes=0-31" },
    });
    if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 32)
      throw new Error("Video byte-range smoke check failed.");
    const invalid = await fetch(origin + clip.viewerUrl, {
      headers: { Range: "bytes=999999999-" },
    });
    if (invalid.status !== 416)
      throw new Error("Unsatisfiable range must return 416.");
    const html = await (await fetch(`${origin}/albums/demo-match`)).text();
    if (html.includes("synthetic-private-keyword"))
      throw new Error("Private metadata leaked.");
    console.log(`\nSynthetic demo ready: ${origin}/albums/demo-match`);
    console.log(
      "Two generated JPEGs and one generated video; no real media or credentials needed.",
    );
    console.log(
      "This isolated loopback demo uses a public test token. Do not use it for private media.",
    );
    if (smoke.length)
      console.log(
        "PASS: mixed import, public gallery, private metadata boundary and video 206/416.",
      );
    else {
      console.log(
        "Open the link, play the clip, try downloads. Press Ctrl+C to stop.",
      );
      await new Promise<void>((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    }
  } finally {
    if (previous === undefined) delete process.env.TOPBINS_PUBLISH_TOKEN;
    else process.env.TOPBINS_PUBLISH_TOKEN = previous;
    server.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.once("exit", () => resolve());
      setTimeout(() => {
        server.kill("SIGKILL");
        resolve();
      }, 5000).unref();
    });
  }
} finally {
  await lock.close();
  await rm(lockPath, { force: true });
}
