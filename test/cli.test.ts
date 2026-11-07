import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));

import { inspectTools } from "../cli/doctor.ts";

describe("media tool diagnostics", () => {
  it("checks project tools using argument arrays without a shell", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: "test version\nmore output",
      stderr: "",
    } as ReturnType<typeof spawnSync>);
    expect(inspectTools()).toEqual([
      { command: "exiftool", ok: true, version: "test version" },
      { command: "ffmpeg", ok: true, version: "test version" },
      { command: "ffprobe", ok: true, version: "test version" },
    ]);
    expect(spawnSync).toHaveBeenCalledWith(
      "ffprobe",
      ["-version"],
      expect.objectContaining({ shell: false, timeout: 10_000 }),
    );
  });

  it("reports missing, broken or timed-out dependencies as failures", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: null,
      error: new Error("cannot execute"),
      stdout: "",
    } as ReturnType<typeof spawnSync>);
    expect(inspectTools().every((tool) => !tool.ok)).toBe(true);
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: "",
    } as ReturnType<typeof spawnSync>);
    expect(inspectTools().every((tool) => !tool.ok)).toBe(true);
  });
});
