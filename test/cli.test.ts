import { spawnSync } from "node:child_process";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));

import { inspectTools } from "../cli/doctor.ts";
import { parseManifest, validateRightsUrl } from "../cli/manifest.ts";
import { validateColorProfile } from "../cli/color-profiles.ts";
import { srgbProfileBase64 } from "./icc-fixture.ts";

const execute = promisify(execFile);
const srgbProfile = Buffer.from(srgbProfileBase64, "base64");

it("reports a missing export folder instead of a misleading lock failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "topbins-missing-"));
  try {
    const result = await execute(process.execPath, [
      "cli/main.ts",
      "import",
      join(dir, "missing"),
      "--manifest",
      join(dir, "missing.json"),
      "--endpoint",
      "http://127.0.0.1:8787",
    ]).catch((error) => error);
    expect(result.stderr).toContain("Import folder does not exist");
    expect(result.stderr).not.toContain("Cannot acquire import lock");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("imports a synthetic JPEG without changing pixels or exposing keywords", async () => {
  const dir = await mkdtemp(join(tmpdir(), "topbins-test-"));
  const requests: { method: string; url: string; body: Buffer }[] = [];
  const assets = new Set<string>();
  let transientFailure = true;
  let statePresentBeforeRequest = false;
  let publishedState: string | null = null;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({
      method: req.method ?? "",
      url: req.url ?? "",
      body: Buffer.concat(chunks),
    });
    statePresentBeforeRequest ||= await readFile(
      join(dir, ".topbins-state.json"),
    ).then(
      () => true,
      () => false,
    );
    if (req.headers.authorization !== "Bearer synthetic-test-token") {
      res.writeHead(401).end();
    } else if (req.method === "GET" && req.url?.includes("/albums/")) {
      if (publishedState === null) res.writeHead(404).end();
      else
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ state: publishedState }));
    } else if (req.method === "HEAD") {
      if (transientFailure) {
        transientFailure = false;
        res.writeHead(503).end();
      } else {
        res.writeHead(assets.has(req.url ?? "") ? 200 : 404).end();
      }
    } else {
      if (req.url?.includes("/assets/")) assets.add(req.url);
      if (req.url?.includes("/albums/"))
        publishedState = JSON.parse(Buffer.concat(chunks).toString()).state;
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ previewUrl: "/preview/test" }));
    }
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("server address missing");
    const source = join(dir, "photo.jpg");
    await execute("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=32x24",
      "-frames:v",
      "1",
      "-threads",
      "1",
      source,
    ]);
    const profile = join(dir, "profile.icc");
    await writeFile(profile, srgbProfile);
    await execute("exiftool", [
      "-overwrite_original",
      `-ICC_Profile<=${profile}`,
      "-IPTC:Keywords=synthetic-private",
      "-XMP-lr:HierarchicalSubject=synthetic|private",
      "-XMP-dc:Creator=Photographer",
      "-IFD0:Orientation#=6",
      "-DateTimeOriginal=2024:01:01 15:04:19",
      "-OffsetTimeOriginal=-04:00",
      "-SubSecTimeOriginal=123",
      "-GPSLatitude=10",
      "-GPSLatitudeRef=N",
      source,
    ]);
    // Lightroom exports carry a fixed-size Adobe APP14 marker (DCT version,
    // flags, YCbCr transform); exiftool cannot write it, so splice the bytes.
    const adobe = Buffer.from("ffee000e41646f626500640000000001", "hex");
    const withAdobe = await readFile(source);
    await writeFile(
      source,
      Buffer.concat([withAdobe.subarray(0, 2), adobe, withAdobe.subarray(2)]),
    );
    const original = await readFile(source);
    const manifest = join(dir, "manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({
        id: "match",
        team: { id: "team", title: "Team" },
        season: { id: "season", title: "Season" },
        title: "Match",
        date: "2024-01-01",
        visibility: "unlisted",
        files: [{ file: "photo.jpg" }],
      }),
    );
    const args = [
      "cli/main.ts",
      "import",
      dir,
      "--manifest",
      manifest,
      "--endpoint",
      `http://127.0.0.1:${address.port}`,
    ];
    const env = {
      ...process.env,
      TOPBINS_PUBLISH_TOKEN: "synthetic-test-token",
    };
    await execute(process.execPath, [...args, "--publish"], { env });
    expect(statePresentBeforeRequest).toBe(true);
    expect(
      requests.filter((request) => request.method === "HEAD"),
    ).toHaveLength(2);
    expect(await readFile(source)).toEqual(original);
    const asset = requests.find(
      (request) => request.method === "PUT" && request.url.includes("/assets/"),
    );
    const album = requests.find(
      (request) => request.method === "PUT" && request.url.includes("/albums/"),
    );
    expect(asset).toBeDefined();
    expect(album).toBeDefined();
    const uploaded = join(dir, "uploaded.jpg");
    await writeFile(uploaded, asset?.body ?? Buffer.alloc(0));
    const metadata = (await execute("exiftool", ["-j", "-G1", "-n", uploaded]))
      .stdout;
    expect(metadata).not.toContain("synthetic-private");
    expect(metadata).not.toContain("GPSLatitude");
    expect(metadata).toContain("Photographer");
    expect(metadata).toContain('"IFD0:Orientation": 6');
    expect(metadata).toContain(
      '"ExifIFD:DateTimeOriginal": "2024:01:01 15:04:19"',
    );
    expect(metadata).toContain('"ExifIFD:OffsetTimeOriginal": "-04:00"');
    expect(metadata).toContain('"ExifIFD:SubSecTimeOriginal"');
    const embeddedProfile = await execute(
      "exiftool",
      ["-b", "-ICC_Profile", uploaded],
      { encoding: "buffer" },
    );
    expect(embeddedProfile.stdout).toEqual(srgbProfile);
    const payload = JSON.parse(album?.body.toString() ?? "{}");
    expect(payload.state).toBe("published");
    expect(
      payload.media[0].privateMetadata.keywords["IPTC:Keywords"],
    ).toContain("synthetic-private");
    expect(payload.media[0]).toMatchObject({
      width: 24,
      height: 32,
      credit: "Photographer",
    });
    const pixels = async (path: string) =>
      (
        await execute("ffmpeg", [
          "-v",
          "error",
          "-noautorotate",
          "-i",
          path,
          "-f",
          "md5",
          "-",
        ])
      ).stdout;
    expect(await pixels(uploaded)).toBe(await pixels(source));
    const id = payload.media[0].id;
    requests.length = 0;
    await execute(process.execPath, args, { env });
    expect(
      requests.filter(
        (request) =>
          request.url.includes("/assets/") && request.method === "PUT",
      ),
    ).toHaveLength(0);
    const repeat = requests.find(
      (request) => request.method === "PUT" && request.url.includes("/albums/"),
    );
    expect(JSON.parse(repeat?.body.toString() ?? "{}").media[0].id).toBe(id);
    expect(JSON.parse(repeat?.body.toString() ?? "{}").state).toBe("published");
    await execute("exiftool", [
      "-overwrite_original",
      "-XMP-dc:Creator=Changed",
      source,
    ]);
    requests.length = 0;
    await expect(execute(process.execPath, args, { env })).rejects.toThrow(
      "--replace",
    );
    expect(requests).toHaveLength(0);
    await execute(process.execPath, [...args, "--replace"], { env });
    const replacement = requests.find(
      (request) => request.method === "PUT" && request.url.includes("/albums/"),
    );
    expect(
      JSON.parse(replacement?.body.toString() ?? "{}").media[0],
    ).toMatchObject({ id, replace: true, credit: "Changed" });
    requests.length = 0;
    await expect(
      execute(process.execPath, [...args.slice(0, -1), "http://example.org"], {
        env,
      }),
    ).rejects.toThrow("loopback");
    expect(requests).toHaveLength(0);
    const modifiedProfile = Buffer.from(srgbProfile);
    modifiedProfile.write("NAME", 252, "ascii");
    await writeFile(profile, modifiedProfile);
    await execute("exiftool", [
      "-overwrite_original",
      `-ICC_Profile<=${profile}`,
      source,
    ]);
    await expect(
      execute(process.execPath, [...args, "--replace"], { env }),
    ).rejects.toThrow("privacy/color review");
    expect(requests).toHaveLength(0);
    await writeFile(
      join(dir, ".topbins-state.json"),
      '{"version":1,"albums":[]}',
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        execute(process.execPath, [...args, "--replace"], { env }),
      ).rejects.toThrow("valid .topbins-state.json");
    }
    expect(requests).toHaveLength(0);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

it("preserves only approved complete ICC profiles, not just familiar descriptions", () => {
  expect(() => validateColorProfile(Buffer.alloc(0))).not.toThrow();
  expect(() => validateColorProfile(srgbProfile)).not.toThrow();
  const privateDescription = Buffer.from(srgbProfile);
  privateDescription.write("NAME", 252, "ascii");
  expect(() => validateColorProfile(privateDescription)).toThrow(
    "privacy/color review",
  );
  expect(() =>
    validateColorProfile(Buffer.concat([srgbProfile, Buffer.from("private")])),
  ).toThrow();
});

describe("publishing manifest validation", () => {
  const valid = {
    id: "match-one",
    team: { id: "team", title: "Team" },
    season: { id: "season", title: "Season" },
    title: "Match",
    date: "2024-02-29",
    visibility: "unlisted",
  };

  it("accepts a valid explicit photo selection", () => {
    expect(
      parseManifest({
        ...valid,
        files: [{ file: "photo.JPG" }],
        cover: "photo.JPG",
      }),
    ).toMatchObject({ ...valid, cover: "photo.JPG" });
  });

  it("accepts MP4 poster selection but rejects ambiguous or unsafe options", () => {
    expect(
      parseManifest({
        ...valid,
        files: [{ file: "clip.mp4", posterTime: 1.5 }],
      }).files?.[0],
    ).toMatchObject({ file: "clip.mp4", posterTime: 1.5 });
    for (const item of [
      { file: "clip.mp4", posterTime: -1 },
      { file: "clip.mp4", poster: "../private.jpg" },
      { file: "clip.mp4", poster: "poster.jpg", posterTime: 0 },
      { file: "photo.jpg", posterTime: 0 },
    ])
      expect(() => parseManifest({ ...valid, files: [item] })).toThrow();
  });

  it("rejects unsafe paths, non-photos, invalid dates and unknown fields", () => {
    for (const file of [
      "../photo.jpg",
      "sub/photo.jpg",
      "sub\\photo.jpg",
      "video.mov",
    ]) {
      expect(() => parseManifest({ ...valid, files: [{ file }] })).toThrow();
    }
    expect(() => parseManifest({ ...valid, date: "2023-02-29" })).toThrow();
    expect(() => parseManifest({ ...valid, visiblity: "public" })).toThrow();
  });

  it("rejects duplicate identities and unsafe rights links", () => {
    const id = "1b8eb643-459a-4a43-b011-712775c66408";
    expect(() =>
      parseManifest({
        ...valid,
        files: [
          { file: "a.jpg", id },
          { file: "b.jpg", id },
        ],
      }),
    ).toThrow();
    expect(() => validateRightsUrl("javascript:alert(1)")).toThrow();
    expect(() => validateRightsUrl("https://user:pass@example.org/")).toThrow();
    expect(validateRightsUrl("https://example.org/rights")).toBe(
      "https://example.org/rights",
    );
  });
});

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
