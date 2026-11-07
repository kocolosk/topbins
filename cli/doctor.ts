import { spawnSync } from "node:child_process";

export const mediaTools = [
  { command: "exiftool", args: ["-ver"] },
  { command: "ffmpeg", args: ["-version"] },
  { command: "ffprobe", args: ["-version"] },
] as const;

export function inspectTools() {
  return mediaTools.map(({ command, args }) => {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      shell: false,
    });
    return {
      command,
      ok: !result.error && result.status === 0,
      version: result.stdout?.split(/\r?\n/, 1)[0]?.trim() ?? "",
    };
  });
}
