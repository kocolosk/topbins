# Photo publishing API

All `/api/publisher/*` requests require `Authorization: Bearer <token>`.
Configure `PUBLISH_TOKEN` as a Worker secret; unset or empty disables publishing.
Never put credentials in URLs. Preview uses the same token, but requires
authentication on every preview page and asset request.
The publisher must sanitize JPEG metadata before upload; the Worker does not
remove GPS, keywords or other embedded metadata.

Upload a sanitized JPEG with `PUT /api/publisher/assets/:sha256`, using its
lowercase SHA-256 and `Content-Type: image/jpeg`. The body must be smaller than
20,000,000 bytes. The Worker bounds streamed request consumption, checks the
digest and actual dimensions, and validates both 640 and 2560 Images presets
before saving a new source. Existing objects are not re-uploaded. `HEAD` checks
existence. R2 custom metadata contains only validated dimensions, not filenames
or extracted private metadata.

`PUT /api/publisher/albums/:id` accepts JSON with `team` and `season` objects
(`id`, `title`), `title`, `date` (`YYYY-MM-DD`), `visibility` (`public` or
`unlisted`), `state` (`draft` or `published`), optional `coverMediaId`, and
`media`. IDs for team, season and album are lowercase hyphenated slugs, up to
80 characters; season IDs are scoped to their team, album IDs are global.
Each media entry has UUID `id`, lowercase
`sha256`, integer `width` and `height`, nullable `captureTime`, `credit`,
`copyright`, `usageTerms`, `rightsUrl`, and object `privateMetadata`. Rights
URLs must use HTTP or HTTPS. Input `captureTime` values must be ISO timestamps
with an explicit timezone and are normalized to UTC internally. Public DTOs
expose `captureTime`, restoring the recorded local time/offset from original
metadata when available. Without an offset, an original local time can be exposed
as a timezone-less ISO value, labeled "timezone unknown" in the gallery; it is
not treated as a known instant. Missing timestamps are null.
Media order is case-sensitive lexicographic `privateMetadata.originalFilename`
order, with stable media ID as the tie-breaker/fallback; capture times do not
override it. Filenames are never included in public responses.
Dimensions must match the inspected source (allowing orientation-swapped axes).
Set `replace: true` to change an existing source.
Omitted existing media remain in the album. All assets must exist before commit.
The response provides `albumUrl` and `previewUrl`; these are relative paths.
Publication and all catalog changes are committed in a D1 batch, with identity
conflict guards. Unsupported writes return 405, invalid data 400, oversize bodies
413, and source/identity/replacement conflicts 409.

`GET /api/publisher/albums/:id` exports the album, including private metadata
and its stable random `shareToken`. Keep exports private. Public JSON contains
only explicitly selected catalog and rights fields, never private metadata.
Unlisted share links are capabilities: anyone possessing one can share it.
The public media URLs are versioned by source hash; draft media is unavailable
without authenticated preview. Dynamic responses use `Cache-Control: no-store`.

## Viewing and preview

- `/`, `/teams/:teamId`, `/teams/:teamId/seasons/:seasonId`: public navigation.
- `/albums/:albumId`: published public album only.
- `/shared/:shareToken`: published album by random share capability.
- `?photo=:mediaId` on an album page opens a stable individual photo view.
- `/api/teams`, `/api/teams/:teamId/seasons`,
  `/api/teams/:teamId/seasons/:seasonId/albums`: public JSON listings.
- `/api/albums/:albumId`, `/api/shared/:shareToken`: `{album}` public projections.
- `/preview/:albumId`, `/api/preview/:albumId`: authenticated, private-free draft
  gallery/JSON, using Basic username `publisher` and password `PUBLISH_TOKEN`,
  or Bearer authentication. Browser asset URLs are also under `/preview/`.

No viewer login is required for published albums. Every HTML page remains
noindex during this implementation phase, including public galleries.

`/media/:mediaId/:sourceHash/grid|viewer|download` resolves the current catalog
reference and publication state, never an arbitrary bucket key. Presets preserve
aspect ratio without upscaling. AVIF/WebP are selected only when explicitly
accepted; otherwise JPEG. The internal edge cache is keyed by media ID, source
version, preset, and format, with a one-day TTL. Every cache hit still requires a
fresh publication check; draft previews bypass the cache. Browser responses
remain no-store. Source downloads use the exact sanitized JPEG, an opaque
filename, ETag/If-None-Match, and HEAD support. Preview and errors are never
publicly cached.

The shared runtime token and Basic browser preview are a minimal local-first
authentication implementation. Review the production policy (including the
Cloudflare Access recommendation) before an approved deployment.

Production image transformation fidelity, service limits, sanitization, and
recovery require independent launch validation; local simulation is not proof.
