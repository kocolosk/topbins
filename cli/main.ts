import { inspectTools } from "./doctor.ts";

const help = `topbins — local-folder publisher scaffold

Usage:
  npm run cli -- --help
  npm run doctor

doctor verifies ExifTool, FFmpeg and FFprobe can execute.
Import, sanitization, authentication, upload and publication are not implemented.
No command reads media files or contacts Cloudflare.`;

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
} else {
  console.error("Unsupported command. Run npm run cli -- --help.");
  process.exitCode = 1;
}
