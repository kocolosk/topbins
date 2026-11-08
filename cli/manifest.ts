import { isAbsolute, basename } from "node:path";

export type Rights = {
  credit?: string;
  copyright?: string;
  usageTerms?: string;
  rightsUrl?: string;
};

export type Manifest = {
  id: string;
  team: { id: string; title: string };
  season: { id: string; title: string };
  title: string;
  date: string;
  visibility: "public" | "unlisted";
  defaults?: Rights;
  cover?: string;
  files?: { file: string; id?: string }[];
};

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(
  value: unknown,
  name: string,
  keys: string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (!keys.includes(key)) throw new Error(`Unknown ${name} field: ${key}`);
  }
  return result;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`${name} must be a nonempty trimmed string`);
  }
  return value;
}

function identifier(value: unknown, name: string): string {
  const result = text(value, name);
  if (!slug.test(result)) throw new Error(`${name} must be a lowercase slug`);
  return result;
}

function filename(value: unknown, name: string): string {
  const result = text(value, name);
  if (
    isAbsolute(result) ||
    basename(result) !== result ||
    result === "." ||
    result === ".." ||
    /[\\/\0]/.test(result)
  ) {
    throw new Error(`${name} must be a filename directly inside the folder`);
  }
  if (!/\.jpe?g$/i.test(result))
    throw new Error(`${name}: only JPEG photos are supported`);
  return result;
}

export function validateRightsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("rightsUrl must be an absolute HTTP(S) URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "rightsUrl must be an absolute HTTP(S) URL without credentials",
    );
  }
  return value;
}

export function parseManifest(value: unknown): Manifest {
  const input = object(value, "manifest", [
    "id",
    "team",
    "season",
    "title",
    "date",
    "visibility",
    "defaults",
    "cover",
    "files",
  ]);
  const team = object(input.team, "team", ["id", "title"]);
  const season = object(input.season, "season", ["id", "title"]);
  const date = text(input.date, "date");
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsedDate.valueOf()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("date must be a valid YYYY-MM-DD date");
  }
  if (input.visibility !== "public" && input.visibility !== "unlisted") {
    throw new Error("visibility must be public or unlisted");
  }
  const result: Manifest = {
    id: identifier(input.id, "id"),
    team: {
      id: identifier(team.id, "team.id"),
      title: text(team.title, "team.title"),
    },
    season: {
      id: identifier(season.id, "season.id"),
      title: text(season.title, "season.title"),
    },
    title: text(input.title, "title"),
    date,
    visibility: input.visibility,
  };
  if (input.defaults !== undefined) {
    const defaults = object(input.defaults, "defaults", [
      "credit",
      "copyright",
      "usageTerms",
      "rightsUrl",
    ]);
    result.defaults = {};
    for (const key of [
      "credit",
      "copyright",
      "usageTerms",
      "rightsUrl",
    ] as const) {
      if (defaults[key] !== undefined) {
        const value = text(defaults[key], `defaults.${key}`);
        result.defaults[key] =
          key === "rightsUrl" ? validateRightsUrl(value) : value;
      }
    }
  }
  if (input.cover !== undefined) result.cover = filename(input.cover, "cover");
  if (input.files !== undefined) {
    if (!Array.isArray(input.files) || input.files.length === 0)
      throw new Error("files must be a nonempty array");
    const files = new Set<string>();
    const ids = new Set<string>();
    result.files = input.files.map((entry: unknown) => {
      const item = object(entry, "file entry", ["file", "id"]);
      const file = filename(item.file, "file");
      if (files.has(file)) throw new Error(`Duplicate file: ${file}`);
      files.add(file);
      if (item.id === undefined) return { file };
      const id = text(item.id, "file id").toLowerCase();
      if (!uuid.test(id)) throw new Error("file id must be a UUID");
      if (ids.has(id)) throw new Error(`Duplicate file id: ${id}`);
      ids.add(id);
      return { file, id };
    });
    if (result.cover && !files.has(result.cover))
      throw new Error("cover must be selected in files");
  }
  return result;
}
