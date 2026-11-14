import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdtemp,
  readFile,
  readdir,
  lstat,
  open,
  rm,
  writeFile,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseManifest, validateRightsUrl } from "./manifest.ts";
import type { Rights } from "./manifest.ts";
import { validateColorProfile } from "./color-profiles.ts";
import { prepareVideo, VIDEO_LIMIT } from "./video.ts";

type Metadata = Record<string, unknown>;
type Entry = { id: string; hash: string };
type State = { version: 1; albums: Record<string, Record<string, Entry>> };

function tool(args: string[]): string {
  const result = spawnSync("exiftool", args, {
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
    maxBuffer: 16_000_000,
  });
  if (result.error || result.status !== 0)
    throw new Error("ExifTool failed; run mise exec -- npm run doctor");
  return result.stdout;
}

function probe(path: string): Metadata {
  const result = JSON.parse(
    tool(["-j", "-G1", "-a", "-n", "-struct", path]),
  ) as Metadata[];
  if (!result[0]) throw new Error("ExifTool returned no metadata");
  if (
    Object.keys(result[0]).some((key) =>
      /^(ExifTool:)?(Warning|Error)$/.test(key),
    )
  )
    throw new Error("ExifTool reported invalid or unsupported metadata");
  return result[0];
}

function colorProfile(path: string): Buffer {
  const result = spawnSync("exiftool", ["-b", "-ICC_Profile", path], {
    shell: false,
    timeout: 30_000,
    maxBuffer: 20_000_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "Cannot inspect color profile; run mise exec -- npm run doctor",
    );
  return result.stdout;
}

function hash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function readSource(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    const limit = /\.mp4$/i.test(path) ? VIDEO_LIMIT : 20_000_000;
    if (!stat.isFile() || stat.size >= limit)
      throw new Error(
        `Source must be a regular file under ${limit / 1_000_000} MB`,
      );
    return await file.readFile();
  } finally {
    await file.close();
  }
}

function value(metadata: Metadata, key: string): string | undefined {
  const raw = metadata[key];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === "string" && first.trim() ? first.trim() : undefined;
}

function rights(
  metadata: Metadata,
  defaults: Rights,
  name: string,
): Required<Record<keyof Rights, string | null>> {
  const tags: Record<keyof Rights, string[]> = {
    credit: ["XMP-dc:Creator", "IPTC:By-line", "IFD0:Artist"],
    copyright: ["XMP-dc:Rights", "IPTC:CopyrightNotice", "IFD0:Copyright"],
    usageTerms: ["XMP-xmpRights:UsageTerms"],
    rightsUrl: ["XMP-xmpRights:WebStatement"],
  };
  const result = {} as Required<Record<keyof Rights, string | null>>;
  for (const key of Object.keys(tags) as (keyof Rights)[]) {
    const found = tags[key]
      .map((tag) => value(metadata, tag))
      .filter((v): v is string => !!v);
    if (new Set(found).size > 1)
      console.warn(
        `${name}: conflicting ${key}; using XMP, then IPTC, then EXIF`,
      );
    const selected = found[0] ?? defaults[key] ?? null;
    result[key] =
      selected && key === "rightsUrl" ? validateRightsUrl(selected) : selected;
  }
  return result;
}

const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];

export interface Credentials {
  headers: Record<string, string>;
  secrets: string[];
}

// Loopback HTTP uses the local shared token. Any remote endpoint must be HTTPS
// and authenticates with a Cloudflare Access service token; the shared token is
// never sent over the network.
export function endpointCredentials(
  input: string,
  environment: NodeJS.ProcessEnv,
): { origin: URL; credentials: Credentials } {
  const url = new URL(input);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol === "http:" && !loopbackHosts.includes(url.hostname)) ||
    (url.protocol !== "http:" && url.protocol !== "https:")
  ) {
    throw new Error(
      "Endpoint must be an https:// origin or an explicit http://localhost loopback origin",
    );
  }
  if (url.protocol === "http:") {
    const token = environment.TOPBINS_PUBLISH_TOKEN;
    if (!token) throw new Error("Set TOPBINS_PUBLISH_TOKEN in the environment");
    return {
      origin: url,
      credentials: {
        headers: { Authorization: `Bearer ${token}` },
        secrets: [token],
      },
    };
  }
  const id = environment.TOPBINS_ACCESS_CLIENT_ID;
  const secret = environment.TOPBINS_ACCESS_CLIENT_SECRET;
  if (!id || !secret)
    throw new Error(
      "Set TOPBINS_ACCESS_CLIENT_ID and TOPBINS_ACCESS_CLIENT_SECRET (a Cloudflare Access service token) in the environment",
    );
  return {
    origin: url,
    credentials: {
      headers: {
        "CF-Access-Client-Id": id,
        "CF-Access-Client-Secret": secret,
      },
      secrets: [id, secret],
    },
  };
}

class RedirectError extends Error {
  constructor(method: string) {
    super(
      `${method} request was redirected (for example to a Cloudflare Access login). Check the service token and that its Access policy allows this path.`,
    );
  }
}

async function request(
  url: URL,
  credentials: Credentials,
  method: string,
  body?: string | Uint8Array<ArrayBuffer>,
  contentType?: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...credentials.headers,
          ...(contentType ? { "Content-Type": contentType } : {}),
          ...extraHeaders,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status >= 300 && response.status < 400)
        throw new RedirectError(method);
      if (response.status < 500 && response.status !== 429) return response;
    } catch (error) {
      if (error instanceof RedirectError) throw error;
      // Network errors and timeouts are safe to retry because writes use PUT.
    }
    if (attempt < 2)
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw new Error(`${method} request failed after retries`);
}

async function saveState(path: string, state: State): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function importFolder(
  folder: string,
  manifestPath: string,
  endpoint: string,
  publish: boolean,
  replace: boolean,
): Promise<void> {
  const directory = await lstat(resolve(folder)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT")
        throw new Error(
          `Import folder does not exist: ${resolve(folder)}. Create an export folder and a match manifest first; see docs/publishing-cli.md or run npm run demo.`,
        );
      throw error;
    },
  );
  if (!directory.isDirectory())
    throw new Error(`Import path is not a directory: ${resolve(folder)}`);
  const lockPath = join(resolve(folder), ".topbins-state.json.lock");
  const lock = await open(lockPath, "wx", 0o600).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST")
        throw new Error(
          "An import lock already exists. Remove .topbins-state.json.lock only after confirming no import is active.",
        );
      throw new Error(
        `Cannot create import lock (${error.code ?? "filesystem error"}). Check export-folder permissions.`,
      );
    },
  );
  try {
    await performImport(folder, manifestPath, endpoint, publish, replace);
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

async function performImport(
  folder: string,
  manifestPath: string,
  endpoint: string,
  publish: boolean,
  replace: boolean,
): Promise<void> {
  folder = resolve(folder);
  manifestPath = resolve(manifestPath);
  const { origin, credentials } = endpointCredentials(endpoint, process.env);
  const manifest = parseManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const names =
    manifest.files?.map((entry) => entry.file) ??
    (await readdir(folder)).filter(
      (name) =>
        name !== ".topbins-state.json" &&
        name !== ".topbins-state.json.lock" &&
        !/^\.topbins-state\.json\.[0-9a-f-]{36}\.tmp$/.test(name) &&
        join(folder, name) !== manifestPath,
    );
  names.sort();
  if (!names.length) throw new Error("No media selected");
  for (const name of names) {
    if (!/\.(jpe?g|mp4)$/i.test(name))
      throw new Error(
        `${name}: unsupported file; select JPEG photos or MP4 videos`,
      );
    const stat = await lstat(join(folder, name));
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`${name}: expected a regular file, not a symlink`);
    const limit = /\.mp4$/i.test(name) ? VIDEO_LIMIT : 20_000_000;
    if (stat.size >= limit)
      throw new Error(
        `${name}: source must be under ${limit / 1_000_000} MB; export a smaller web version`,
      );
  }
  if (manifest.cover && !names.includes(manifest.cover))
    throw new Error("Cover is not among the selected files");
  const statePath = join(folder, ".topbins-state.json");
  let state: State;
  try {
    state = JSON.parse(await readFile(statePath, "utf8")) as State;
    if (
      state.version !== 1 ||
      !state.albums ||
      typeof state.albums !== "object" ||
      Array.isArray(state.albums)
    )
      throw new Error("invalid state");
    const seen = new Set<string>();
    for (const [albumId, files] of Object.entries(state.albums)) {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(albumId) ||
        !files ||
        typeof files !== "object" ||
        Array.isArray(files)
      )
        throw new Error("invalid state");
      for (const entry of Object.values(files)) {
        if (
          !entry ||
          typeof entry !== "object" ||
          typeof entry.id !== "string" ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(entry.id) ||
          typeof entry.hash !== "string" ||
          !/^[0-9a-f]{64}$/.test(entry.hash) ||
          seen.has(entry.id)
        )
          throw new Error("invalid state");
        seen.add(entry.id);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Cannot read valid .topbins-state.json");
    state = { version: 1, albums: {} };
  }
  if (!Object.hasOwn(state.albums, manifest.id)) state.albums[manifest.id] = {};
  const entries = state.albums[manifest.id];
  if (!entries || typeof entries !== "object" || Array.isArray(entries))
    throw new Error("Invalid album state");
  const ids = new Set(
    Object.values(state.albums).flatMap((files) =>
      Object.values(files).map((entry) => entry.id),
    ),
  );
  const sourceHashes = new Map<string, string>();
  for (const name of names) {
    const sourceHash = hash(await readSource(join(folder, name)));
    sourceHashes.set(name, sourceHash);
    const specified = manifest.files?.find((file) => file.file === name)?.id;
    const existing = entries[name];
    if (existing && specified && existing.id !== specified)
      throw new Error(`${name}: manifest ID conflicts with saved identity`);
    if (existing && existing.hash !== sourceHash && !replace)
      throw new Error(`${name}: source changed; use --replace explicitly`);
    if (!existing) {
      const id = specified ?? randomUUID();
      if (ids.has(id))
        throw new Error(`${name}: ID already belongs to another file`);
      ids.add(id);
      entries[name] = { id, hash: sourceHash };
    }
  }
  await saveState(statePath, state);
  const temporary = await mkdtemp(join(tmpdir(), "topbins-"));
  try {
    const media: Record<string, unknown>[] = [];
    const assets: {
      sha256: string;
      path: string;
      type?: string;
      headers?: Record<string, string>;
    }[] = [];
    for (const [index, name] of names.entries()) {
      const bytes = await readSource(join(folder, name));
      if (hash(bytes) !== sourceHashes.get(name))
        throw new Error(`${name}: source changed during import`);
      const isVideo = /\.mp4$/i.test(name);
      const source = join(
        temporary,
        `${index}-input.${isVideo ? "mp4" : "jpg"}`,
      );
      await writeFile(source, bytes, { mode: 0o600 });
      const metadata = probe(source);
      if (
        isVideo &&
        (bytes.includes(Buffer.from("c2pa")) ||
          bytes.includes(Buffer.from("jumb")) ||
          Object.keys(metadata).some((key) => /c2pa|jumbf/i.test(key)))
      )
        throw new Error(
          `${name}: Content Credentials/JUMBF detected; evaluate provenance before importing`,
        );
      if (isVideo) {
        const output = join(temporary, `${index}.mp4`);
        const poster = join(temporary, `${index}-poster.jpg`);
        const selection = manifest.files?.find((file) => file.file === name);
        let posterPath: string | undefined;
        if (selection?.poster) {
          const original = join(folder, selection.poster);
          const stat = await lstat(original);
          if (!stat.isFile() || stat.isSymbolicLink())
            throw new Error("Poster must be a regular JPEG, not a symlink.");
          posterPath = join(temporary, `${index}-supplied-poster.jpg`);
          await writeFile(posterPath, await readSource(original), {
            mode: 0o600,
          });
          validateColorProfile(colorProfile(posterPath));
          const posterBytes = await readFile(posterPath);
          if (
            posterBytes.includes(Buffer.from("c2pa")) ||
            posterBytes.includes(Buffer.from("jumb"))
          )
            throw new Error(
              "Poster contains Content Credentials/JUMBF; evaluate provenance before importing.",
            );
        }
        const prepared = await prepareVideo(source, output, poster, {
          posterTime: selection?.posterTime,
          posterPath,
        });
        const posterSha256 = hash(prepared.posterBytes);
        const sha256 = hash(await readFile(output));
        assets.push({ sha256: posterSha256, path: poster });
        assets.push({
          sha256,
          path: output,
          type: "video/mp4",
          headers: {
            "X-Video-Width": String(prepared.width),
            "X-Video-Height": String(prepared.height),
            "X-Video-Duration": String(prepared.duration),
          },
        });
        media.push({
          id: entries[name]?.id,
          sha256,
          width: prepared.width,
          height: prepared.height,
          kind: "video",
          duration: prepared.duration,
          posterSha256,
          captureTime: prepared.captureTime,
          ...rights(metadata, manifest.defaults ?? {}, name),
          privateMetadata: {
            originalFilename: name,
            keywords: Object.fromEntries(
              Object.entries(metadata).filter(([key]) =>
                /^(IPTC:Keywords|XMP-dc:Subject|XMP-lr:HierarchicalSubject)$/.test(
                  key,
                ),
              ),
            ),
          },
          ...(replace ? { replace: true } : {}),
        });
        continue;
      }
      if (metadata["File:FileType"] !== "JPEG")
        throw new Error(`${name}: not a JPEG`);
      const originalProfile = colorProfile(source);
      validateColorProfile(originalProfile);
      // C2PA manifests are embedded in JPEG APP11 JUMBF boxes. Refuse them before stripping.
      if (
        bytes.includes(Buffer.from("c2pa", "ascii")) ||
        bytes.includes(Buffer.from("jumb", "ascii")) ||
        Object.keys(metadata).some((key) => /c2pa|jumbf/i.test(key))
      ) {
        throw new Error(
          `${name}: Content Credentials/JUMBF detected; evaluate provenance before importing`,
        );
      }
      const width = Number(metadata["File:ImageWidth"]);
      const height = Number(metadata["File:ImageHeight"]);
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width > 12000 ||
        height > 12000 ||
        width * height > 100_000_000
      )
        throw new Error(`${name}: unsupported image dimensions`);
      const orientation = Number(metadata["IFD0:Orientation"] ?? 1);
      if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8)
        throw new Error(`${name}: invalid orientation`);
      const approved = rights(metadata, manifest.defaults ?? {}, name);
      const privateMetadata: Metadata = {
        originalFilename: name,
        keywords: {},
      };
      const keywords = privateMetadata.keywords as Metadata;
      for (const [key, value] of Object.entries(metadata)) {
        if (
          /^(IPTC:Keywords|XMP-dc:Subject|XMP-lr:HierarchicalSubject)$/.test(
            key,
          )
        )
          keywords[key] = value;
      }
      const capture = value(metadata, "ExifIFD:DateTimeOriginal");
      const offset = value(metadata, "ExifIFD:OffsetTimeOriginal");
      let captureTime: string | null = null;
      if (
        capture &&
        offset &&
        /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d$/.test(capture) &&
        /^[+-]\d\d:\d\d$/.test(offset)
      ) {
        const iso = `${capture.slice(0, 10).replaceAll(":", "-")}T${capture.slice(11)}${offset}`;
        if (!Number.isNaN(Date.parse(iso))) captureTime = iso;
      }
      if (!captureTime)
        console.warn(
          `${name}: capture time or timezone missing/invalid; no timezone will be inferred`,
        );
      privateMetadata.captureTimeOriginal = capture ?? null;
      privateMetadata.captureOffsetOriginal = offset ?? null;
      privateMetadata.rightsOriginal = Object.fromEntries(
        Object.entries(metadata).filter(([key]) =>
          /^(XMP-dc:Creator|IPTC:By-line|IFD0:Artist|XMP-dc:Rights|IPTC:CopyrightNotice|IFD0:Copyright|XMP-xmpRights:UsageTerms|XMP-xmpRights:WebStatement)$/.test(
            key,
          ),
        ),
      );
      const output = join(temporary, `${index}.jpg`);
      await writeFile(output, bytes, { mode: 0o600 });
      const args = [
        "-overwrite_original",
        "-all=",
        "-tagsFromFile",
        source,
        "-ICC_Profile",
        "-ColorSpace",
        "-Orientation",
        "-ExifIFD:DateTimeOriginal",
        "-ExifIFD:OffsetTimeOriginal",
        "-ExifIFD:SubSecTimeOriginal",
      ];
      if (approved.credit) args.push(`-XMP-dc:Creator=${approved.credit}`);
      if (approved.copyright) args.push(`-XMP-dc:Rights=${approved.copyright}`);
      if (approved.usageTerms)
        args.push(`-XMP-xmpRights:UsageTerms=${approved.usageTerms}`);
      if (approved.rightsUrl)
        args.push(`-XMP-xmpRights:WebStatement=${approved.rightsUrl}`);
      tool([...args, output]);
      const sanitized = await readFile(output);
      if (sanitized.length >= 20_000_000)
        throw new Error(`${name}: sanitized file must be under 20 MB`);
      const verified = probe(output);
      const allowed =
        /^(SourceFile|ExifTool:|System:|File:|JPEG:|JFIF:|Composite:|ICC_Profile:|ICC-header:|IFD0:Orientation$|IFD0:YCbCrPositioning$|ExifIFD:(ColorSpace|ExifVersion|ComponentsConfiguration|DateTimeOriginal|OffsetTimeOriginal|SubSecTimeOriginal)$|XMP-x:XMPToolkit$|XMP-dc:Creator$|XMP-dc:Rights$|XMP-xmpRights:UsageTerms$|XMP-xmpRights:WebStatement$)/;
      const unexpected = Object.keys(verified).filter(
        (key) => !allowed.test(key),
      );
      if (unexpected.length)
        throw new Error(
          `${name}: sanitization verification failed: ${unexpected.join(", ")}`,
        );
      if (Number(verified["IFD0:Orientation"] ?? 1) !== orientation)
        throw new Error(`${name}: orientation was not preserved`);
      if (
        metadata["ExifIFD:ColorSpace"] !== undefined &&
        metadata["ExifIFD:ColorSpace"] !== verified["ExifIFD:ColorSpace"]
      )
        throw new Error(`${name}: color space was not preserved`);
      if (
        Object.keys(metadata).some((key) => key.startsWith("ICC_Profile:")) &&
        !Object.keys(verified).some((key) => key.startsWith("ICC_Profile:"))
      )
        throw new Error(`${name}: ICC profile was not preserved`);
      if (!colorProfile(output).equals(originalProfile))
        throw new Error(`${name}: ICC profile bytes were not preserved`);
      for (const tag of [
        "DateTimeOriginal",
        "OffsetTimeOriginal",
        "SubSecTimeOriginal",
      ]) {
        if (metadata[`ExifIFD:${tag}`] !== verified[`ExifIFD:${tag}`])
          throw new Error(`${name}: capture metadata was not preserved`);
      }
      const sha256 = hash(sanitized);
      assets.push({ sha256, path: output });
      media.push({
        id: entries[name]?.id,
        sha256,
        width: orientation >= 5 ? height : width,
        height: orientation >= 5 ? width : height,
        captureTime,
        ...approved,
        privateMetadata,
        ...(replace ? { replace: true } : {}),
      });
    }
    // names were sorted lexicographically before import. Capture times are
    // display metadata, not a reliable burst-ordering key.
    // Importing more photos must not implicitly unpublish an existing album.
    const albumUrl = new URL(`/api/publisher/albums/${manifest.id}`, origin);
    const existing = await request(albumUrl, credentials, "GET");
    let publicationState = publish ? "published" : "draft";
    if (existing.ok) {
      const saved = (await existing.json()) as { state?: unknown };
      if (saved.state !== "draft" && saved.state !== "published")
        throw new Error("Invalid publisher album response");
      if (!publish) publicationState = saved.state;
    } else if (existing.status !== 404) {
      throw new Error(`Album check failed (HTTP ${existing.status})`);
    }
    for (const [index, asset] of assets.entries()) {
      console.log(`Staging asset ${index + 1} of ${assets.length}`);
      const url = new URL(`/api/publisher/assets/${asset.sha256}`, origin);
      if (asset.type) url.searchParams.set("type", asset.type);
      const head = await request(url, credentials, "HEAD");
      if (head.status === 404) {
        const upload = await request(
          url,
          credentials,
          "PUT",
          new Uint8Array(await readFile(asset.path)),
          asset.type ?? "image/jpeg",
          asset.headers,
        );
        if (!upload.ok)
          throw new Error(`Asset upload failed (HTTP ${upload.status})`);
      } else if (!head.ok)
        throw new Error(`Asset check failed (HTTP ${head.status})`);
    }
    const coverMediaId = manifest.cover
      ? entries[manifest.cover]?.id
      : undefined;
    const response = await request(
      albumUrl,
      credentials,
      "PUT",
      JSON.stringify({
        team: manifest.team,
        season: manifest.season,
        title: manifest.title,
        date: manifest.date,
        visibility: manifest.visibility,
        state: publicationState,
        coverMediaId,
        media,
      }),
      "application/json",
    );
    if (!response.ok)
      throw new Error(`Album update failed (HTTP ${response.status})`);
    for (const name of names) {
      const entry = entries[name];
      const sourceHash = sourceHashes.get(name);
      if (entry && sourceHash) entry.hash = sourceHash;
    }
    await saveState(statePath, state);
    const result = (await response.json()) as Record<string, unknown>;
    for (const key of ["albumUrl", "previewUrl"])
      if (
        typeof result[key] === "string" &&
        !credentials.secrets.some((secret) =>
          result[key]?.toString().includes(secret),
        )
      )
        console.log(`${key}: ${result[key]}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
