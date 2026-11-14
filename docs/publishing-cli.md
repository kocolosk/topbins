# Local photo/video publishing CLI

For a first trial, run `mise exec -- npm run demo`: it supplies synthetic JPEGs,
an MP4, a manifest, and isolated local storage, then prints a working gallery
link. It requires no real media or credentials. Ctrl+C stops it.

For your own exports, this is a local-only publisher. Start the local Worker with
its publisher token configured separately, and supply the same secret in the
CLI process environment as `TOPBINS_PUBLISH_TOKEN`. Do not put it in the
manifest, command history, or a tracked file. Browser preview requires the
publisher's credentials; the CLI does not put the token in preview URLs.

For local development, manually supply `PUBLISH_TOKEN` in the ignored
`.dev.vars` file consumed by Wrangler; use the same value in the CLI environment,
supplied by your secret manager or a non-echoing shell prompt. Do not commit or
share either value. Restart the local Worker after setting it. Preview prompts
for username `publisher` and the token as the password. No Cloudflare credential
is needed and an unset token fails closed.

```sh
mise exec -- npm run cli -- import ./exports --manifest ./match.json --endpoint http://127.0.0.1:8787
```

The endpoint is mandatory: an HTTP loopback origin, or an HTTPS origin using a
Cloudflare Access service token ([access.md](access.md)). The command
creates a draft unless `--publish` is present. Re-imports preserve an existing
album's publication state; omission of `--publish` never implicitly unpublishes.
Visibility is explicitly provided in the manifest. The response provides
relative preview and album URLs; open them on the specified local origin.

`./exports` and `./match.json` are example inputs, not repository fixtures.
Create the export folder, export your JPEG/MP4 files into it, and write the
manifest below before running the import command. A missing folder now reports
that directly rather than suggesting a stale lock.

Example manifest (all data below is synthetic):

```json
{
  "id": "match-2024-04-01",
  "team": { "id": "example-team", "title": "Example team" },
  "season": { "id": "spring-2024", "title": "Spring 2024" },
  "title": "Example match",
  "date": "2024-04-01",
  "visibility": "unlisted",
  "defaults": { "credit": "Example photographer" },
  "cover": "photo.jpg",
  "files": [{ "file": "photo.jpg" }]
}
```

IDs are lowercase slugs. `defaults` may also specify `copyright`, `usageTerms`,
and an HTTP(S) `rightsUrl`; embedded rights take precedence. No permission is
inferred. `files` is optional; without it all folder entries other than the
manifest and state file must be JPEGs or MP4s. Explicit `files` selects a subset and may
provide a UUID `id` for each photo. Files must be direct regular files, not
symlinks. Other unsupported files are errors, not silently skipped.

## Short videos

Export MP4 / H.264 8-bit SDR, with AAC audio if present. HEVC, HDR, unsupported
codecs, and multiple video/audio tracks are rejected with export guidance rather
than silently transcoded. 1080p is recommended; compatible 4K is accepted within
the size limit. Preserve source frame rate and audio. Sources and published
MP4s must be **under 100,000,000 bytes**; try roughly 8 Mbps at 30 fps or 12 Mbps
at 60 fps for a smaller web export.

The importer stream-copies video/audio, strips metadata and extra data tracks,
prepares fast start, and verifies required playback properties. A single poster
frame is encoded locally. Example selection:

```json
{ "file": "9O0A3024.mp4", "posterTime": 1.5 }
```

Alternatively set `"poster": "cover.jpg"` to use a supplied JPEG from the same
folder. Poster files must be regular, non-symlink JPEGs and follow the approved
color-profile/provenance policy. The timestamp must be within the clip.
Posters use Cloudflare image presets, not hosted Images storage.

Clips are interleaved with photos by original filename. The grid loads only
posters; opening a clip presents native controls without autoplay. Closing or
changing items stops and releases playback. Download returns the largest
published MP4, not a new browser-sized rendition. The original local file is
never modified. Container creation time is used for display when present; note
that some export tools set this to export time rather than camera capture time.

The Worker streams video uploads and validates size, digest, signature, and
publisher-declared dimensions/duration. Codec and metadata verification is the
trusted local publisher's responsibility; the Worker does not decode videos.

The ignored `.topbins-state.json` in the export folder maps names to IDs and
source hashes; keep it with the export for reliable resume. This repository's
ignore rule does not cover other Git repositories: ensure their ignore rules
also cover that file. State is saved before network requests. Changed sources
require `--replace`; keep that flag on retries until replacement succeeds.
Missing local files never request deletion. Retain the original exports and
back up the state separately; the site is not the archive.

Imports take an exclusive `.topbins-state.json.lock` for the folder; concurrent
imports fail rather than invent competing identities. A terminated process can
leave the lock behind. Remove it only after confirming no import is active.
Malformed state fails closed; do not delete state to work around errors.
If local state is lost, recover IDs and original filenames from the authenticated
album export before importing again, or provide explicit IDs in the manifest.
Otherwise a new filename without a saved/explicit ID is a new photo, not an
automatic rename or replacement.

The CLI retains EXIF capture date/time, available timezone offset, and subsecond
precision in downloaded JPEGs. The gallery/API expose capture time and recorded
offset; missing offsets are labeled unknown, not inferred from the viewer's
location. Original camera/export filenames determine case-sensitive lexicographic
album order, even when timestamps tie or disagree. Stable media IDs break ties.
Filenames remain private. The CLI warns when an offset or timestamp is missing.
IPTC/XMP keyword originals are included only in authenticated private
metadata; they are not included in sanitized source files. ExifTool removes
metadata and restores only capture fields, orientation, color profile/color space, and
approved rights, without recompressing pixels. C2PA/JUMBF content is refused
for explicit provenance review. Input and output must be below 20,000,000
bytes; dimensions must not exceed 12,000 pixels per side or 100 megapixels.
Temporary copies are removed on normal completion or failure; abrupt process
termination may leave OS temporary files, so use an appropriately private
temporary directory.

ICC profiles can themselves contain identifying text. The importer preserves
only byte-for-byte approved profiles from `cli/color-profiles.ts`, verified by
SHA-256; unknown profiles stop before any upload. Approved profiles are the
public CC0 compact sRGB profile and the HP "sRGB IEC61966-2.1" profile that the
publisher's Lightroom exports embed (its tags were reviewed; see the comment in
that file). Any other profile fingerprint requires privacy/color review before
approval. Never assign
a different profile merely to bypass the check: that can change color appearance.
Tests include an approved profile and the same color-transform data with changed
descriptive text, which is rejected. JPEGs with no ICC continue under the
color-space/orientation policy.

Asset checks and idempotent PUTs are retried for transient failures. A complete
catalog update happens only after every selected asset is staged. Actual managed
Images transformation behavior still requires separately approved remote
validation before real publication. This CLI does not implement a full private
metadata export command.

Sanitized files are staged on private temporary storage and uploaded one at a
time rather than retaining an entire album in memory. If an upload or catalog
commit fails, re-run with the same folder/state and flags; existing assets are
checked by digest and skipped. Unreferenced staged sources may remain in R2;
automatic orphan deletion is intentionally not implemented.
