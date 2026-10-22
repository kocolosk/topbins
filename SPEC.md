# Sports gallery — v1 specification

Status: implementation baseline.

This document records the product and architecture decisions from the planning
discussion. Items labeled **proposed default** are recommendations, not previously
confirmed requirements. Implementation may refine technical details without
changing the product promises below.

## 1. Purpose and scope

Publish curated photos and occasional short videos of high-school sports matches,
primarily for players and families to browse, download, and share.

- Expected volume: about 50 photos per match, up to 20 matches per season, and a
  few thousand photos overall.
- Photos are edited JPEG exports from Adobe Lightroom cloud, not RAW files.
- Videos are occasional stills-camera clips, generally 10–30 seconds.
- The publisher exports to a local folder and uses a CLI to publish it.
- Hosting should use Cloudflare-native services with low recurring cost and
  little operational maintenance.
- The site is a publishing destination, not the sole archive or backup.

### Out of scope for v1

- Viewer accounts, individual invitations, and per-user permissions.
- Comments, reactions, player uploads, or multiple publishing roles.
- Player-name search, public player directories, or automated identification.
- Direct Lightroom integration or a browser-based administration interface.
- RAW storage, server-side video transcoding, and adaptive video streaming.
- Bulk ZIP downloads, commerce, and print ordering.

## 2. Organization and browsing

The browsing hierarchy is **team → season → match**.

- Teams have seasons; seasons contain match albums.
- An album has a title, match date, cover, publication state, and visibility.
- Albums contain photos and videos in a shared ordering.
- Capture time supplies the initial ordering; ambiguous or missing timestamps
  must be handled deterministically and reported during import.
- Visitors can open an individual media item and share a stable link to it.
- A photo's public link remains stable when its source is explicitly replaced.

### Gallery experience

- Mobile-friendly album grid and full-screen media viewer.
- Photos retain their complete composition and aspect ratio; no automatic
  cropping of normal gallery items.
- Touch navigation on phones and keyboard navigation on desktop.
- Images load at display-appropriate sizes, not at source resolution in the grid.
- Individual download actions are clear and available without sign-in.
- Photographer credit and usage information appear in the viewer or near the
  download action.
- Provide a simple contact/removal-request path.

**Proposed defaults:** newest matches first within a season; chronological media
ordering within an album; a justified photo grid; explicitly selected covers,
falling back to the first photo. Visual design remains open.

## 3. Publication and visibility

Publication and visibility are separate properties:

- Publication: `draft` or `published`.
- Visibility: `public` or `unlisted`.

### Draft

- Not accessible through normal visitor routes, listings, or public APIs.
- Publisher can preview it through an authenticated preview mechanism.
- First publication is explicit and happens only after required assets and
  metadata are ready; do not expose a partially imported new album.

### Public

- Appears in its team/season listings and applicable public search results.
- May appear in sitemaps and be indexed by search engines.

### Unlisted

- Accessible without sign-in through a hard-to-guess, random share URL.
- Omitted from public navigation, listings, sitemaps, and public search.
- Album and media pages request non-indexing.
- Public APIs must not enumerate unlisted albums or leak their contents.
- Direct asset URLs can be shared and remain accessible to their recipients.
- No promise of identity-based privacy, expiring access, or immediate revocation
  of previously shared asset URLs.

Unlisted means **not discoverable through the site**, not private. Changing a
public album to unlisted cannot undo indexing, redistribution, or downloads.
Download permissions do not differ between public and unlisted albums in v1.

**Proposed default:** newly created albums remain drafts until explicitly
published, and visibility is explicitly chosen on initial publication.

## 4. Photo storage, transformations, and downloads

- Store the largest uploaded JPEG for each photo in R2 as its published source.
- Do not also store the photo in hosted Cloudflare Images.
- Use Cloudflare-managed image transformations for display sizes.
- Do not pregenerate photo display variants during import.
- Restrict transformations to approved presets rather than arbitrary client
  parameters.
- Preserve aspect ratio and avoid upscaling.
- Negotiate efficient browser formats for viewing.
- Download serves the sanitized published source JPEG from R2, without resizing
  or recompressing it.
- Existing photos can have different source resolutions.
- A subsequent explicit source replacement may upgrade a photo's resolution.
- Replacements use versioned asset URLs to prevent stale display variants while
  preserving the stable media-page link.

Existing 3072 × 2048 exports are suitable; uploading full-resolution 24/32 MP
JPEGs is optional. Sources have sometimes exceeded 10 MB but have been under
20 MB. The chosen transformation integration must have adequate input limits.
Upload must not succeed only for display generation to fail silently later.

**Proposed initial presets:** a 640 × 640 bounding box for grid images and a
2560 × 2560 bounding box for the viewer, both scale-down without cropping.
Tune quality and responsive sizing against real images and devices.

## 5. Metadata and sanitization

Read metadata before sanitizing. Never modify the publisher's input files.

### Preserve privately

- Original keyword strings from IPTC and XMP, including hierarchical keywords
  when present.
- Capture timestamp and available timezone information for ordering.
- Original filename and provenance needed for repeatable imports.
- Extracted credit/rights fields needed for publication.

Normalize duplicate keyword representations without losing the original values.
Do not infer a player model or split names automatically in v1.

Private metadata belongs in publisher-only records, not public R2 object
metadata or gallery responses. Private keywords must not appear in HTML,
frontend payloads, public APIs, autocomplete, filenames, or downloadable files.

### Publish selectively

Extract and normalize these fields where available:

- Creator/photographer: IPTC By-line, XMP Creator, EXIF Artist.
- Copyright notice: IPTC Copyright Notice, XMP Rights, EXIF Copyright.
- Usage terms: XMP Rights Usage Terms.
- Rights URL: XMP Web Statement of Rights.

Use site-wide defaults for missing fields. Explicit embedded values take
precedence; report meaningful conflicts between metadata representations.
Credit and copyright do not imply permission: never invent usage terms from
either. Treat metadata as untrusted text and validate public URLs.

Sanitize a publishing copy before upload:

- Remove GPS, keywords, identifying filenames, and unapproved metadata.
- Preserve correct orientation, color appearance, and approved rights fields.
- Prefer metadata-only operations that do not re-encode JPEG pixels.
- Apply the same policy to download sources, not only display variants.
- Do not remove provenance/Content Credentials casually; if encountered,
  explicitly evaluate handling rather than assuming all metadata is disposable.

The final site-wide credit, usage terms, and contact details require approval
before public launch, but do not block implementation.

## 6. Video

### Supported workflow

- Import short, browser-compatible MP4s into the same albums as photos.
- Playback source is stored in R2; no Cloudflare Stream dependency in v1.
- H.264 video, 8-bit SDR, with AAC audio when present, is the baseline profile.
- Inspect container, codecs, dimensions, frame rate, duration, and rotation.
- Recommend 1080p exports; do not reject compatible 4K solely for resolution.
- Warn about unusually large or demanding files before publication.
- Explain incompatible formats; do not silently transcode them.
- Prepare fast-start MP4 layout by remuxing when needed and safe.
- Extract a poster frame locally; allow a timestamp or supplied-image override.
- Sanitize location and unwanted identifying metadata while preserving required
  playback, rotation, and color information.
- Preserve audio; no publishing-time mute option is required in v1.
- Download serves the largest published video file stored for the item in R2.
  Uploading a web export does not imply retaining the camera original online.

### Viewer

- Grid tiles show a poster, play indicator, and duration.
- No autoplay or background video loading in the grid.
- Load video on demand when the visitor opens/plays a clip.
- Use native playback controls and fullscreen support.
- Support HTTP byte ranges, seeking, and streaming responses without buffering
  whole files in Worker memory.
- Posters use the normal managed image transformation path.

### Recommended export profile, not a mandatory conversion

- MP4 / H.264 / AAC, 1080p, 8-bit SDR.
- Preserve source frame rate, typically 30 or 60 fps.
- Starting video bitrate: about 8 Mbps at 30 fps or 12 Mbps at 60 fps.
- Audio: about 128–192 kbps.
- Fast start enabled when available.

Validate visual quality against sports footage before fixing export guidance.
Do not add a server transcoder to accommodate an incompatible sample; discuss
local conversion or managed Stream if export preparation becomes burdensome.

## 7. Publishing CLI

The CLI accepts an export folder with JPEGs, MP4s, and album metadata.
Exact command syntax and manifest format are implementation choices.

Required behavior:

- Identify the team, season, album, date, visibility, and optional cover.
- Preflight files and report unsupported media or metadata issues clearly.
- Extract private metadata before producing sanitized temporary copies.
- Upload with progress, retries, and restart/resume behavior.
- Re-running unchanged inputs does not duplicate media or recreate assets.
- Add media to an existing album.
- Replace an existing item's source explicitly, retaining its public page link.
- Missing local files never silently delete published items.
- Deletion/unpublishing requires an explicit operation.
- Provide a draft preview before first publication.
- Track enough state to recover from failures between asset upload and catalog
  updates without publishing broken items.
- Keep credentials outside committed files and avoid logging secrets.

Authentication is required for publishing and preview, but not viewing.
The authentication mechanism and local tool dependencies remain technical
implementation choices. No requirement for a browser admin UI.

## 8. Architecture

### Cloudflare Worker with static frontend assets

- Serves gallery routes, public catalog APIs, and publisher-only operations.
- Enforces publication and visibility rules.
- Provides download/media serving routes as needed.
- Supports conditional responses and video range requests.
- Prevents draft/private metadata leaks through responses or caches.

### D1

- Stores teams, seasons, albums, media ordering, visibility, publication state,
  stable media identifiers, and asset references.
- Stores private metadata separately from public response projections.
- Represents photo/video differences explicitly, including video duration and
  poster reference.
- Supports export of the catalog and privately retained metadata.

### R2

- Stores sanitized photo sources, published videos, and video posters.
- Uses opaque/versioned asset identifiers rather than player names.
- No public bucket listing.
- Asset exposure must match the stated draft and unlisted behavior.

### Cloudflare image transformations

- Produces approved display sizes from R2 sources and posters.
- Input-size limits and cache behavior must be validated for the chosen API.
- No hosted Images storage is required.

### Local tooling

- Reads metadata, sanitizes copies, probes video, and extracts poster frames.
- May use established tools such as ExifTool and FFmpeg rather than maintaining
  custom production parsers for media formats.
- Prefer `mise` to manage a hermetic project toolchain where supported, with
  pinned tool versions in committed configuration rather than reliance on
  ambient system installations.
- Document setup commands and any dependencies that cannot be managed through
  `mise` in the implementation's developer setup guide.
- Missing/broken dependencies produce actionable diagnostics.

Keep service count small: no queue, Durable Object, managed video service, or
background processing system unless implementation demonstrates a concrete need.

## 9. Acceptance checklist

### Publishing and organization

- [ ] Import a mixed-media match under team → season → match.
- [ ] Draft preview works without exposing the draft publicly.
- [ ] First publication exposes only an album with all required assets ready.
- [ ] Interrupted import can resume without duplicates.
- [ ] Unchanged repeat import is a no-op for media uploads.
- [ ] Explicit replacement preserves the item link and updates displayed assets.
- [ ] Removing an input file does not delete published content.

### Visibility

- [ ] Public albums appear in the correct listings.
- [ ] Unlisted albums work through random share URLs without sign-in.
- [ ] Unlisted content is absent from public listings, sitemaps, and enumeration
      APIs; its pages request non-indexing.
- [ ] Draft assets and publisher-only metadata are not leaked by routes/caches.

### Images and metadata

- [ ] Grid/viewer variants preserve composition, orientation, and color.
- [ ] Downloads match the largest sanitized published source, not a variant.
- [ ] GPS and keyword metadata are absent from downloaded JPEGs.
- [ ] Imported keywords survive in a private metadata export.
- [ ] Embedded creator/rights values display when present; defaults cover gaps.
- [ ] No usage permission is inferred from copyright alone.

### Video

- [ ] A compatible exported clip plays and seeks on desktop and mobile browsers.
- [ ] Video posters load without fetching the clip in the album grid.
- [ ] Fast-start preparation preserves audio/video quality and synchronization.
- [ ] Download returns the published video source.
- [ ] Incompatible footage and excessive file sizes produce clear diagnostics.
- [ ] Metadata sanitization does not break orientation or playback.

### Operational

- [ ] Validate photo viewing, downloads, and video playback on iOS Safari and a
      Chromium browser, including Android/mobile behavior.
- [ ] Keyboard navigation and accessible labels work in the media viewer.
- [ ] Catalog/private-metadata export and source recovery are documented.
- [ ] No secrets are committed or exposed in frontend code.
- [ ] Record configured service limits, caching policy, and expected cost drivers.

## 10. Sample findings and remaining validation

Samples were inspected read-only in the publisher's primary checkout. At the time
of inspection, they were not replicated into the attached Delta worktree.

`examples/9O0A3044.jpg`:

- 3072 × 2048, 1,216,205 bytes, sRGB, Canon EOS R7.
- Capture time and timezone offset present.
- `nefc` keyword present in IPTC and XMP; GPS coordinates present.
- No creator/copyright/usage values found in the inspected standard fields.
- Extensive Lightroom XMP editing metadata present.

`examples/9O0A3024.mp4`:

- About 31.6 seconds, 3840 × 2160, approximately 29.97 fps.
- H.264 High Profile Level 5.1; AAC stereo, 48 kHz.
- 166,342,079 bytes; approximately 42 Mbps total average bitrate.
- MP4 index (`moov`) follows media data: not fast-start prepared.

The installed FFprobe failed because of a missing Homebrew x265 library.
Read-only format parsing established the properties above; decoding, conversion,
sanitization, poster generation, and actual browser playback were not validated.
The photo sample does not exercise player-name keywords or populated rights
fields; add appropriate fixtures when validating those cases.

## 11. Open but nonblocking choices

Hosting domain confirmed on 2026-10-22: **`photos.kocolosk.net`**.

Remaining choices:

- Site name, visual design, and exact route/CLI syntax.
- Final photographer credit, rights text, and contact details (launch gate).
- Metadata conflict precedence and timezone fallback details.
- Exact image quality settings and video warning thresholds.
- How stable media identity is mapped during explicit source replacement.
- Publisher authentication, preview mechanism, and deployment tooling.
- Final image transformation API and its verified input limits.

These are implementation or launch decisions, not reasons to expand v1 scope.
