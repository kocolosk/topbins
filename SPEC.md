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
- Adam Kocoloski is the sole publisher in v1. Team organization supports browsing,
  not collaborative ownership or contributions.

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

Use a gallery-first design with restrained branding, minimal navigation, and
obvious download/share actions. Match titles, teams, and dates take precedence
over site branding. `topbins` is an internal project name; no public site name
or logo is required. Photographer credit must be discoverable, not prominent
name-based branding.

**Proposed defaults:** newest matches first within a season; chronological media
ordering within an album; a justified photo grid; explicitly selected covers,
falling back to the first photo. Detailed visual styling remains open.

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

### Capture timestamps

- Honor source capture timestamps and explicit timezone offsets.
- Interpret timezone-less camera timestamps as `America/New_York`, using the
  capture date's daylight-saving rules rather than a fixed UTC offset.
- Report missing, ambiguous, or conflicting timestamp metadata during preflight;
  ordering must remain deterministic.
- Do not infer or correct timezones from GPS coordinates or GPS UTC timestamps,
  convert timestamps based on location, or maintain separate publisher-corrected
  times in the gallery. The publisher corrects RAWs/Lightroom or exported JPEGs
  upstream so the gallery and source workflow remain consistent.

### Publish selectively

Extract and normalize these fields where available:

- Creator/photographer: IPTC By-line, XMP Creator, EXIF Artist.
- Copyright notice: IPTC Copyright Notice, XMP Rights, EXIF Copyright.
- Usage terms: XMP Rights Usage Terms.
- Rights URL: XMP Web Statement of Rights.
- Camera model, lens model, focal length, shutter speed, aperture, and ISO.

Use site-wide defaults for missing fields. Explicit embedded values take
precedence; report meaningful conflicts between metadata representations.
Credit and copyright do not imply permission: never invent usage terms from
either. Treat metadata as untrusted text and validate public URLs.

Approved camera/exposure fields may remain in downloadable JPEGs and be included
in the public catalog for an optional photo-details display. Do not rely on
transformed display images retaining embedded metadata.

Sanitize a publishing copy before upload:

- Remove GPS, keywords, identifying filenames, camera/lens serial numbers, and
  other unapproved metadata.
- Preserve correct orientation, color appearance, approved rights fields, and
  the explicitly approved camera/exposure fields. Do not retain whole EXIF blocks
  or manufacturer MakerNotes merely to preserve those fields.
- Prefer metadata-only operations that do not re-encode JPEG pixels.
- Apply the same policy to download sources, not only display variants.
- Do not remove provenance/Content Credentials casually; if encountered,
  explicitly evaluate handling rather than assuming all metadata is disposable.

### Site-wide credit, usage, and contact defaults

- Default photographer credit: **Adam Kocoloski**, discoverable in the viewer's
  details or near the download action. Explicit embedded credits take precedence.
- Public contact for questions, removal requests, and additional permissions:
  **photos@kocolosk.net**, linked with `mailto:`. The alias is expected to be
  operational; confirm mail receipt before launch, without assuming DNS or email
  configuration changes are needed.
- Players, families, and team/club accounts may download and repost photos,
  including ordinary team/club promotional social posts. Attribution is
  appreciated, not required. Cropping and resizing for sharing are allowed.
- Standing permission covers editorial reporting on the pictured match, team,
  or players, including by commercial publications. Editorial use requires
  **Adam Kocoloski** credit and a gallery link where practical. Cropping and
  resizing are allowed; misleading edits and implied endorsement are not.
- Paid advertising, merchandise, resale, and stock redistribution require
  separate permission through the contact address above.

These are approved default usage terms, not permissions inferred from copyright.
Final presentation of the public wording and the default copyright notice remain
launch details; explicit embedded rights values still take precedence.

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

### Filename-facing identity and replacement

- Export filenames are the publisher's primary identifiers within a selected
  album. Internal stable media IDs are bookkeeping, not normally user-managed.
- Maintain an album-scoped filename → stable media ID mapping independent of the
  export folder's absolute path; allow reuse of that mapping from another folder.
- Detect unchanged inputs by content so repeat imports are no-ops. Changed
  content under a mapped filename is a replacement candidate requiring an
  explicit action, not an automatic replacement or duplicate import.
- A renamed export requires an explicit previous-filename/existing-item target
  for replacement. Missing or ambiguous mappings must not trigger guessed
  replacements based only on filenames or timestamps.
- Stable public media links use internal identity, not original filenames.
  Replacement changes the asset version, not the media-page identity.

### Publisher authentication and preview

- Cloudflare Access protects dedicated publisher and draft-preview routes.
- The CLI uses a service token stored outside the repository.
- Browser preview initially allows only the publisher's GitHub identity; verify
  the GitHub-backed sign-in integration and restrict it to the specific account,
  not all GitHub users.
- The Worker validates Access tokens and the intended audience rather than
  trusting spoofable identity headers.
- Public and unlisted viewing never requires sign-in. No browser admin UI,
  publisher invitations, or role-management workflow is required.

Exact Access policy configuration, account identifiers, and credential storage
details remain implementation work. This design does not itself authorize remote
Access configuration or credential issuance.

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
- Use the Images binding to transform streams from private R2 without exposing
  public source URLs.
- Input-size limits and cache behavior must be validated in production. Follow
  the conservative preflight ceiling of no more than 20,000,000 sanitized input
  bytes and dimension checks described in `docs/cloudflare.md`.
- Verify managed transformation success before first publication; binding
  deployment and local simulation alone do not validate real inputs.
- No hosted Images storage is required.

### Deployment

- Automatically deploy `main` after a PR lands, gated on successful checks for
  the merged commit. A separate manual release is not the intended workflow.
- Apply forward-only D1 migrations before deploying the Worker and stop on
  failure. Migrations must remain compatible with the currently running Worker
  during that sequence.
- Keep deployment credentials separate from gallery-publishing credentials.
- Application deployment does not publish draft albums; publication remains an
  explicit publisher action.
- Workflow implementation, least-privilege secrets, and branch protections remain
  setup work. This policy does not itself authorize provisioning credentials,
  changing repository settings, or deploying a particular change.

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

- Detailed visual styling and exact route/CLI syntax and manifest format.
- Field-specific metadata conflict precedence.
- Exact image quality settings and video warning thresholds.
- Whether compatible but unusually large video may always proceed after a
  warning remains a proposed policy, not a confirmed requirement.
- Access integration/policy details, specific GitHub account identification, and
  secure CLI credential storage.
- Automatic deployment workflow details, migration failure/recovery handling,
  least-privilege credentials, and repository protections.
- Final public wording/layout of the approved credit and usage defaults, and a
  default copyright notice (launch details).

Remaining validation and launch gates:

- Verify Images binding limits and behavior with approved non-private fixtures,
  including large inputs, orientation, color, and transformation failures.
- Validate authenticated preview, token/audience enforcement, sanitization,
  publication/visibility boundaries, and real browser photo/video behavior.
- Confirm receipt at `photos@kocolosk.net`.

No public site name is needed to proceed. Credit/contact and usage policy,
timezone fallback, filename-facing stable identity, authentication direction,
and automatic deployment policy are settled in the sections above.

These are implementation or launch decisions, not reasons to expand v1 scope.
