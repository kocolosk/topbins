import { spawnSync } from "node:child_process";
import { readFile, lstat } from "node:fs/promises";

export const VIDEO_LIMIT = 100_000_000;

interface Stream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  color_transfer?: string;
  avg_frame_rate?: string;
  side_data_list?: { rotation?: number }[];
  tags?: Record<string, string>;
}
interface Probe {
  streams: Stream[];
  format: {
    duration: string;
    format_name: string;
    size?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
}

function command(tool: string, args: string[]): string {
  const result = spawnSync(tool, args, {
    encoding: "utf8",
    shell: false,
    timeout: 120_000,
    maxBuffer: 4_000_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${tool} failed preparing video. Run mise exec -- npm run doctor; check the file and web export profile.`,
    );
  return result.stdout;
}

function inspect(path: string): Probe {
  return JSON.parse(
    command("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path,
    ]),
  ) as Probe;
}

function rotation(stream: Stream): number {
  return (
    stream.side_data_list?.find((item) => item.rotation !== undefined)
      ?.rotation ?? 0
  );
}

export async function prepareVideo(
  source: string,
  output: string,
  poster: string,
  options: { posterTime?: number; posterPath?: string } = {},
) {
  const before = inspect(source);
  const videos = before.streams.filter(
    (stream) => stream.codec_type === "video",
  );
  const audio = before.streams.filter(
    (stream) => stream.codec_type === "audio",
  );
  const video = videos[0];
  if (
    videos.length !== 1 ||
    !video ||
    video.codec_name !== "h264" ||
    !["yuv420p", "yuvj420p"].includes(video.pix_fmt ?? "") ||
    ["smpte2084", "arib-std-b67"].includes(video.color_transfer ?? "") ||
    audio.length > 1 ||
    audio.some((stream) => stream.codec_name !== "aac")
  ) {
    throw new Error(
      "Video needs an MP4 web export: H.264 8-bit SDR, AAC audio if present, one video/audio track. No automatic transcoding is performed.",
    );
  }
  if (!before.format.format_name.split(",").includes("mp4"))
    throw new Error("Video must be an MP4 export.");
  const duration = Number(before.format.duration);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !video.width ||
    !video.height
  )
    throw new Error("Video has invalid dimensions or duration.");
  const angle = rotation(video);
  if (angle % 90 !== 0)
    throw new Error(
      "Video rotation must be a multiple of 90 degrees; export a normalized MP4.",
    );
  const swap = Math.abs(angle % 180) === 90;
  const width = swap ? video.height : video.width;
  const height = swap ? video.width : video.height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 12000 ||
    height > 12000 ||
    width * height > 100_000_000
  )
    throw new Error("Video dimensions exceed supported media limits.");
  const [frames, seconds] = (video.avg_frame_rate ?? "0/1")
    .split("/")
    .map(Number);
  const fps = Number(frames) / Number(seconds);
  if (
    width > 1920 ||
    height > 1920 ||
    duration > 30 ||
    fps > 60 ||
    Number(before.format.size) > 30_000_000 ||
    Number(before.format.bit_rate) > 15_000_000
  )
    console.warn(
      "Video exceeds the recommended web profile (1080p, 30–60 fps, 10–30 seconds); consider a smaller export.",
    );
  const posterTime = options.posterTime ?? Math.min(1, duration / 2);
  if (!Number.isFinite(posterTime) || posterTime < 0 || posterTime >= duration)
    throw new Error("posterTime must fall within the video duration.");
  command("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-y",
    "-i",
    source,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    "-map_metadata",
    "-1",
    "-map_metadata:s",
    "-1",
    "-map_chapters",
    "-1",
    "-movflags",
    "+faststart",
    output,
  ]);
  const after = inspect(output);
  const afterVideo = after.streams.find(
    (stream) => stream.codec_type === "video",
  );
  const afterAudio = after.streams.filter(
    (stream) => stream.codec_type === "audio",
  );
  if (
    !afterVideo ||
    afterVideo.codec_name !== video.codec_name ||
    afterVideo.width !== video.width ||
    afterVideo.height !== video.height ||
    rotation(afterVideo) !== angle ||
    afterAudio.length !== audio.length ||
    Math.abs(Number(after.format.duration) - duration) > 0.1
  )
    throw new Error("Video remux changed required playback properties.");
  const allowed = new Set([
    "major_brand",
    "minor_version",
    "compatible_brands",
    "encoder",
    "language",
    "handler_name",
    "vendor_id",
  ]);
  for (const tags of [
    after.format.tags,
    ...after.streams.map((stream) => stream.tags),
  ]) {
    if (tags && Object.keys(tags).some((key) => !allowed.has(key)))
      throw new Error("Video retains unapproved metadata after remux.");
  }
  const metadata = JSON.parse(
    command("exiftool", ["-j", "-G1", "-n", output]),
  ) as Record<string, unknown>[];
  if (
    Object.keys(metadata[0] ?? {}).some((key) =>
      /GPS|:(?:Location[^:]*|Keywords|Subject|HierarchicalSubject|Comment|Artist|Author|OwnerName|Description|Title)$/i.test(
        key,
      ),
    )
  )
    throw new Error(
      "Video retains identifying metadata after remux; export a clean web copy.",
    );
  if ((await lstat(output)).size >= VIDEO_LIMIT)
    throw new Error(
      "Published MP4 must be under 100 MB; export a smaller 1080p clip.",
    );
  // FFmpeg normalizes rotation when decoding the poster. It never transcodes
  // the published MP4; only this single still frame is encoded.
  command("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-y",
    ...(options.posterPath ? [] : ["-ss", String(posterTime)]),
    "-i",
    options.posterPath ?? output,
    "-frames:v",
    "1",
    "-vf",
    "scale=w='min(2560,iw)':h='min(2560,ih)':force_original_aspect_ratio=decrease",
    "-map_metadata",
    "-1",
    "-threads",
    "1",
    poster,
  ]);
  command("exiftool", ["-overwrite_original", "-all=", poster]);
  const created =
    before.format.tags?.creation_time ?? video.tags?.creation_time;
  const captureTime =
    created &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(created) &&
    !Number.isNaN(Date.parse(created))
      ? new Date(created).toISOString()
      : null;
  return {
    width,
    height,
    duration: Number(after.format.duration),
    captureTime,
    posterBytes: await readFile(poster),
  };
}
