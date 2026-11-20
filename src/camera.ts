// Public camera details. The importer records a fixed set of EXIF fields in
// private metadata (see cli/provenance.ts); only those, validated and
// formatted here, ever reach a response. Unknown keys, wrong types and
// oversized or control-character strings are dropped, never passed through.

export interface CameraDetail {
  label: string;
  value: string;
}

const programs = [
  "Not defined",
  "Manual",
  "Program AE",
  "Aperture priority",
  "Shutter priority",
  "Creative",
  "Action",
  "Portrait",
  "Landscape",
];
const metering: Record<number, string> = {
  1: "Average",
  2: "Center-weighted",
  3: "Spot",
  4: "Multi-spot",
  5: "Multi-segment",
  6: "Partial",
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100) return null;
  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
  }
  return trimmed;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trim(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

export function publicCamera(raw: unknown): CameraDetail[] | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const camera = raw as Record<string, unknown>;
  const details: CameraDetail[] = [];
  const add = (label: string, value: string | null) => {
    if (value) details.push({ label, value });
  };

  const make = text(camera.Make);
  const model = text(camera.Model);
  add(
    "Camera",
    model && make && !model.toLowerCase().startsWith(make.toLowerCase())
      ? `${make} ${model}`
      : (model ?? make),
  );
  add("Lens", text(camera.LensModel));

  const focal = number(camera.FocalLength);
  const equivalent = number(camera.FocalLengthIn35mmFormat);
  if (focal !== null && focal > 0) {
    const base = `${trim(focal, 1)} mm`;
    add(
      "Focal length",
      equivalent !== null &&
        equivalent > 0 &&
        Math.round(equivalent) !== Math.round(focal)
        ? `${base} (${Math.round(equivalent)} mm equivalent)`
        : base,
    );
  }
  const aperture = number(camera.FNumber);
  if (aperture !== null && aperture > 0)
    add("Aperture", `f/${trim(aperture, 1)}`);
  const shutter = number(camera.ExposureTime);
  if (shutter !== null && shutter > 0)
    add(
      "Shutter",
      shutter >= 0.5
        ? `${trim(shutter, 1)} s`
        : `1/${Math.round(1 / shutter)} s`,
    );
  const iso = number(camera.ISO);
  if (iso !== null && iso > 0) add("ISO", String(Math.round(iso)));
  const compensation = number(camera.ExposureCompensation);
  if (compensation !== null && Math.abs(compensation) < 30)
    add(
      "Exposure compensation",
      `${compensation > 0 ? "+" : ""}${trim(compensation, 2)} EV`,
    );
  const program = number(camera.ExposureProgram);
  if (program !== null && program >= 1 && program < programs.length)
    add("Exposure program", programs[program] ?? null);
  const meter = number(camera.MeteringMode);
  if (meter !== null) add("Metering", metering[meter] ?? null);
  const flash = number(camera.Flash);
  if (flash !== null && Number.isInteger(flash) && flash >= 0)
    add("Flash", flash & 1 ? "Fired" : "Did not fire");
  const balance = number(camera.WhiteBalance);
  if (balance === 0 || balance === 1)
    add("White balance", balance === 0 ? "Auto" : "Manual");

  return details.length ? details : null;
}
