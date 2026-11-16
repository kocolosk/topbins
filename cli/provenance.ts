// AI-disclosure extraction. Content Credentials (C2PA) cannot survive
// sanitization: their hard binding covers every byte except the manifest, and
// we must remove GPS, serial numbers and keywords. We therefore read the
// declared IPTC digital source type, keep only a closed vocabulary of it, and
// republish it as first-party metadata. The manifest signature is NOT
// verified; this is a disclosure aid, not proof.
export type AiDisclosure = "ai-edited" | "ai-generated";

const vocabulary = "http://cv.iptc.org/newscodes/digitalsourcetype/";
const known: Record<string, AiDisclosure> = {
  [`${vocabulary}trainedAlgorithmicMedia`]: "ai-generated",
  [`${vocabulary}compositeWithTrainedAlgorithmicMedia`]: "ai-edited",
};

export const digitalSourceType: Record<AiDisclosure, string> = {
  "ai-generated": `${vocabulary}trainedAlgorithmicMedia`,
  "ai-edited": `${vocabulary}compositeWithTrainedAlgorithmicMedia`,
};

function strings(value: unknown): string[] {
  if (typeof value === "string") return value.split(/,\s*/);
  if (Array.isArray(value)) return value.flatMap(strings);
  return [];
}

// `values` are raw DigitalSourceType declarations from C2PA actions and XMP.
export function classify(...values: unknown[]): AiDisclosure | null {
  const found = values.flatMap(strings).map((v) => known[v.trim()]);
  if (found.includes("ai-generated")) return "ai-generated";
  return found.includes("ai-edited") ? "ai-edited" : null;
}

// True if the JPEG has an APP11 "JP" (JUMBF/C2PA) segment. Structural on
// purpose: approved rights text may legitimately contain "c2pa" or "jumb".
export function hasJumbfSegment(jpeg: Uint8Array): boolean {
  let offset = 2;
  while (offset + 4 <= jpeg.length && jpeg[offset] === 0xff) {
    const marker = jpeg[offset + 1] as number;
    if (marker === 0xda || marker === 0xd9) return false;
    const length =
      ((jpeg[offset + 2] as number) << 8) | (jpeg[offset + 3] as number);
    if (
      marker === 0xeb &&
      jpeg[offset + 4] === 0x4a &&
      jpeg[offset + 5] === 0x50
    )
      return true;
    offset += 2 + length;
  }
  return false;
}

// Camera/exposure fields that pass through to downloads and are recorded for a
// future "camera details" view. Serial numbers (body, lens, internal), owner
// names, GPS, thumbnails and maker notes are deliberately absent.
export const cameraTags = [
  "IFD0:Make",
  "IFD0:Model",
  "ExifIFD:LensMake",
  "ExifIFD:LensModel",
  "ExifIFD:LensInfo",
  "ExifIFD:FocalLength",
  "ExifIFD:FocalLengthIn35mmFormat",
  "ExifIFD:FNumber",
  "ExifIFD:ExposureTime",
  "ExifIFD:ISO",
  "ExifIFD:ExposureProgram",
  "ExifIFD:ExposureCompensation",
  "ExifIFD:ExposureMode",
  "ExifIFD:MeteringMode",
  "ExifIFD:Flash",
  "ExifIFD:WhiteBalance",
] as const;
