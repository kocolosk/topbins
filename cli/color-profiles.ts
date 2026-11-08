import { createHash } from "node:crypto";

// Preserve approved profiles byte-for-byte: blindly copying arbitrary ICC tags
// can retain identifying text, while assigning a different profile changes color.
// Add fingerprints only after reviewing the complete public-source profile.
// CC0 sRGB-v2-magic.icc, saucecontrol/Compact-ICC-Profiles,
// commit bdd84663061bc4ae95ca70decff54f581e27f702.
const approved = new Set([
  "af4efe28f6d311799865f325ba39184a2e978b113ca74124d60af7de22b105f4",
]);

export function validateColorProfile(profile: Buffer): void {
  if (!profile.length) return;
  const digest = createHash("sha256").update(profile).digest("hex");
  if (!approved.has(digest)) {
    throw new Error(
      `ICC profile ${digest} needs privacy/color review before import. Do not strip or replace it blindly; descriptive tags can contain private text. No files have been uploaded.`,
    );
  }
}
