import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { classify } from "../cli/provenance.ts";

const execute = promisify(execFile);
const iptc = "http://cv.iptc.org/newscodes/digitalsourcetype/";

// Minimal synthetic C2PA manifest: one c2pa.actions assertion declaring a
// digital source type. Not signed; the importer only reads the declaration.
function jumbf(sourceType: string): Buffer {
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const box = (type: string, ...parts: Buffer[]) => {
    const body = Buffer.concat(parts);
    return Buffer.concat([u32(8 + body.length), Buffer.from(type), body]);
  };
  const jumd = (type: string, label: string) =>
    box(
      "jumd",
      Buffer.concat([
        Buffer.from(type),
        Buffer.from("00110010800000aa00389b71", "hex"),
      ]),
      Buffer.from([3]),
      Buffer.from(`${label}\0`),
    );
  const text = (s: string) => {
    const b = Buffer.from(s);
    return Buffer.concat([
      b.length < 24
        ? Buffer.from([0x60 + b.length])
        : Buffer.from([0x78, b.length]),
      b,
    ]);
  };
  const cbor = Buffer.concat([
    Buffer.from([0xa1]),
    text("actions"),
    Buffer.from([0x81, 0xa2]),
    text("action"),
    text("c2pa.edited"),
    text("digitalSourceType"),
    text(sourceType),
  ]);
  const actions = box(
    "jumb",
    jumd("cbor", "c2pa.actions.v2"),
    box("cbor", cbor),
  );
  const assertions = box("jumb", jumd("c2as", "c2pa.assertions"), actions);
  const manifest = box("jumb", jumd("c2ma", "urn:c2pa:synthetic"), assertions);
  const payload = Buffer.concat([
    Buffer.from("JP"),
    Buffer.from([0x02, 0x11]),
    u32(1),
    box("jumb", jumd("c2pa", "c2pa"), manifest),
  ]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xeb]), length, payload]);
}

describe("AI disclosure vocabulary", () => {
  it("maps only known IPTC source types", () => {
    expect(classify(`${iptc}compositeWithTrainedAlgorithmicMedia`)).toBe(
      "ai-edited",
    );
    expect(classify([`${iptc}trainedAlgorithmicMedia`, "x"])).toBe(
      "ai-generated",
    );
    expect(
      classify(
        `${iptc}compositeWithTrainedAlgorithmicMedia, ${iptc}trainedAlgorithmicMedia`,
      ),
    ).toBe("ai-generated");
    expect(classify(`${iptc}digitalCapture`)).toBeNull();
    expect(classify("<script>alert(1)</script>", undefined, 3, [])).toBeNull();
  });
});

async function importPhoto(
  prepare: (path: string, dir: string) => Promise<void>,
  defaults: Record<string, string> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "topbins-prov-"));
  const requests: { method: string; url: string; body: Buffer }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({
      method: req.method ?? "",
      url: req.url ?? "",
      body: Buffer.concat(chunks),
    });
    if (req.method === "GET") res.writeHead(404).end();
    else if (req.method === "HEAD") res.writeHead(404).end();
    else
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ previewUrl: "/preview/test" }));
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
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
    await prepare(source, dir);
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
        defaults,
        files: [{ file: "photo.jpg" }],
      }),
    );
    const result = await execute(
      process.execPath,
      [
        "cli/main.ts",
        "import",
        dir,
        "--manifest",
        manifest,
        "--endpoint",
        `http://127.0.0.1:${address.port}`,
      ],
      {
        env: { ...process.env, TOPBINS_PUBLISH_TOKEN: "synthetic-test-token" },
      },
    );
    const asset = requests.find(
      (r) => r.method === "PUT" && r.url.includes("/assets/"),
    );
    const album = requests.find(
      (r) => r.method === "PUT" && r.url.includes("/albums/"),
    );
    const uploaded = join(dir, "uploaded.jpg");
    await writeFile(uploaded, asset?.body ?? Buffer.alloc(0));
    return {
      stderr: result.stderr,
      bytes: asset?.body ?? Buffer.alloc(0),
      payload: JSON.parse(album?.body.toString() ?? "{}"),
      metadata: (await execute("exiftool", ["-j", "-G1", uploaded])).stdout,
    };
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("importing photos with provenance metadata", () => {
  it("strips Content Credentials but records the AI disclosure", async () => {
    const result = await importPhoto(async (source) => {
      const jpeg = await readFile(source);
      await writeFile(
        source,
        Buffer.concat([
          jpeg.subarray(0, 2),
          jumbf(`${iptc}compositeWithTrainedAlgorithmicMedia`),
          jpeg.subarray(2),
        ]),
      );
    });
    expect(result.stderr).toContain("Content Credentials removed");
    expect(result.payload.media[0].aiDisclosure).toBe("ai-edited");
    expect(result.bytes.includes(Buffer.from("c2pa"))).toBe(false);
    expect(result.bytes.includes(Buffer.from("jumb"))).toBe(false);
    expect(result.metadata).toContain(
      `${iptc}compositeWithTrainedAlgorithmicMedia`,
    );
  });

  it("records a plain XMP declaration and nothing for ordinary photos", async () => {
    const declared = await importPhoto(async (source) => {
      await execute("exiftool", [
        "-overwrite_original",
        `-XMP-iptcExt:DigitalSourceType=${iptc}trainedAlgorithmicMedia`,
        source,
      ]);
    });
    expect(declared.payload.media[0].aiDisclosure).toBe("ai-generated");
    expect(declared.metadata).toContain(`${iptc}trainedAlgorithmicMedia`);
    const plain = await importPhoto(async () => {});
    expect(plain.payload.media[0].aiDisclosure).toBeNull();
    expect(plain.metadata).not.toContain("DigitalSourceType");
  });

  it("does not mistake approved rights text for leftover credentials", async () => {
    const result = await importPhoto(async () => {}, {
      credit: "jumbo c2pa studio",
      rightsUrl: "https://example.test/c2pa-license",
    });
    expect(result.payload.media[0]).toMatchObject({
      credit: "jumbo c2pa studio",
      rightsUrl: "https://example.test/c2pa-license",
      aiDisclosure: null,
    });
  });

  it("passes camera and exposure details through but never serial numbers", async () => {
    const result = await importPhoto(async (source) => {
      await execute("exiftool", [
        "-overwrite_original",
        "-Make=SyntheticCam",
        "-Model=Synthetic X1",
        "-LensModel=Synthetic 100mm f/2",
        "-FNumber=2.8",
        "-ExposureTime=0.001",
        "-ISO=800",
        "-FocalLength=100",
        "-SerialNumber=SYNTH-BODY-123",
        "-LensSerialNumber=SYNTH-LENS-456",
        "-OwnerName=Synthetic Owner",
        "-GPSLatitude=10",
        "-GPSLatitudeRef=N",
        source,
      ]);
    });
    expect(result.metadata).toContain("SyntheticCam");
    expect(result.metadata).toContain("Synthetic 100mm f/2");
    expect(result.metadata).toContain('"ExifIFD:ISO": 800');
    for (const secret of ["SYNTH-BODY", "SYNTH-LENS", "Synthetic Owner", "GPS"])
      expect(result.metadata).not.toContain(secret);
    expect(result.payload.media[0].privateMetadata.camera).toMatchObject({
      Make: "SyntheticCam",
      Model: "Synthetic X1",
      ISO: 800,
    });
    expect(JSON.stringify(result.payload)).not.toContain("SYNTH-");
  });
});
