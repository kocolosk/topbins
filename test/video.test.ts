import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { prepareVideo } from "../cli/video.ts";

const execute = promisify(execFile);

it("remuxes synthetic H.264/AAC without changing packet payloads, strips metadata, and creates a poster", async () => {
  const dir = await mkdtemp(join(tmpdir(), "topbins-video-"));
  try {
    const source = join(dir, "source.mp4");
    const output = join(dir, "published.mp4");
    const poster = join(dir, "poster.jpg");
    await execute("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-metadata",
      "location=+10.0000+010.0000/",
      "-metadata",
      "comment=synthetic-private-keyword",
      "-metadata",
      "creation_time=2026-10-10T12:00:00Z",
      source,
    ]);
    const original = await readFile(source);
    const result = await prepareVideo(source, output, poster, {
      posterTime: 0.2,
    });
    expect(result).toMatchObject({
      width: 320,
      height: 180,
      captureTime: "2026-10-10T12:00:00.000Z",
    });
    expect(result.duration).toBeGreaterThanOrEqual(1);
    expect(result.posterBytes[0]).toBe(0xff);
    expect(await readFile(source)).toEqual(original);
    const published = await readFile(output);
    expect(original.indexOf("moov")).toBeGreaterThan(original.indexOf("mdat"));
    expect(published.indexOf("moov")).toBeLessThan(published.indexOf("mdat"));
    const probe = async (path: string) =>
      JSON.parse(
        (
          await execute("ffprobe", [
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            path,
          ])
        ).stdout,
      );
    const after = await probe(output);
    expect(
      after.streams.map((stream: { codec_name: string }) => stream.codec_name),
    ).toEqual(["h264", "aac"]);
    expect(JSON.stringify(after)).not.toContain("synthetic-private-keyword");
    expect(after.format.tags.location).toBeUndefined();
    expect(after.format.tags["location-eng"]).toBeUndefined();
    const packets = async (path: string) =>
      JSON.parse(
        (
          await execute("ffprobe", [
            "-v",
            "error",
            "-show_packets",
            "-show_data_hash",
            "sha256",
            "-show_entries",
            "packet=stream_index,data_hash,pts_time,dts_time,duration_time",
            "-of",
            "json",
            path,
          ])
        ).stdout,
      ).packets as {
        stream_index: number;
        data_hash: string;
      }[];
    const beforePackets = await packets(source),
      afterPackets = await packets(output);
    for (const track of [0, 1]) {
      expect(afterPackets.filter((p) => p.stream_index === track)).toEqual(
        beforePackets.filter((p) => p.stream_index === track),
      );
    }
    await expect(
      prepareVideo(source, output, poster, { posterTime: 100 }),
    ).rejects.toThrow("duration");
    const rotated = join(dir, "rotated.mp4");
    await execute("ffmpeg", [
      "-v",
      "error",
      "-display_rotation",
      "90",
      "-i",
      source,
      "-c",
      "copy",
      rotated,
    ]);
    const rotationResult = await prepareVideo(rotated, output, poster);
    expect(rotationResult).toMatchObject({ width: 180, height: 320 });
    const unsupported = join(dir, "unsupported.mp4");
    await execute("ffmpeg", [
      "-v",
      "error",
      "-i",
      source,
      "-an",
      "-c:v",
      "mpeg4",
      unsupported,
    ]);
    await expect(prepareVideo(unsupported, output, poster)).rejects.toThrow(
      "H.264",
    );
    await writeFile(join(dir, "invalid.mp4"), "not a video");
    await expect(
      prepareVideo(join(dir, "invalid.mp4"), output, poster),
    ).rejects.toThrow("ffprobe");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
