import { inspectTools } from "./doctor.ts";
import { importFolder } from "./import.ts";

const help = `topbins — local-folder publisher

Usage:
  npm run cli -- --help
  npm run demo
  npm run cli -- import <folder> --manifest <path> --endpoint http://127.0.0.1:8787 [--publish] [--replace]
  npm run doctor

Set TOPBINS_PUBLISH_TOKEN in the environment. Only explicit local HTTP endpoints are accepted.
doctor verifies ExifTool, FFmpeg and FFprobe can execute.`;

const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
  console.log(help);
} else if (args.length === 1 && args[0] === "doctor") {
  const tools = inspectTools();
  for (const tool of tools) {
    console.log(
      tool.ok
        ? `OK ${tool.command}: ${tool.version}`
        : `FAIL ${tool.command}: unavailable or broken. Run mise install --locked node conda:ffmpeg conda:exiftool, then mise exec -- npm run doctor. Do not repair a system installation for this project.`,
    );
  }
  if (tools.some((tool) => !tool.ok)) process.exitCode = 1;
} else if (args[0] === "import") {
  try {
    const folder = args[1];
    if (!folder || folder.startsWith("--"))
      throw new Error("Import requires a folder");
    let manifest: string | undefined;
    let endpoint: string | undefined;
    let publish = false;
    let replace = false;
    for (let i = 2; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--manifest" && !manifest && args[i + 1])
        manifest = args[++i];
      else if (arg === "--endpoint" && !endpoint && args[i + 1])
        endpoint = args[++i];
      else if (arg === "--publish" && !publish) publish = true;
      else if (arg === "--replace" && !replace) replace = true;
      else throw new Error(`Invalid or duplicate option: ${arg}`);
    }
    if (!manifest || !endpoint)
      throw new Error("Import requires --manifest and --endpoint");
    await importFolder(folder, manifest, endpoint, publish, replace);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Import failed");
    process.exitCode = 1;
  }
} else {
  console.error("Unsupported command. Run npm run cli -- --help.");
  process.exitCode = 1;
}
