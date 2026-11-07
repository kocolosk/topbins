# Cloudflare foundation and launch gates

## Initial read-only inspection

Inspection from the supplied baseline found an active `kocolosk.net` zone in
Adam Kocoloski's account. Existing Workers are `college-recruiting-tracker` and
`nefc-soccer-profiles`; D1 databases belong to recruiting/profiles (production
and staging); R2 buckets belong to player photos and recruiting email (production
and staging). No topbins resource was found. Do not reuse those unrelated
databases/buckets or change their configuration.

During initial inspection only account/zone/resource listings were read; no object
contents, database records, Worker source or credentials were retrieved. Images
entitlement and billing were not verified then. No remote changes were made
during that initial inspection.
The GitHub MCP repository read returned HTTP 403 (insufficient scopes), so no
GitHub settings or branch protections are assumed verified. Local Git refs
identified `origin/main` at planning commit
`b8f650298cb46764d8c6c27b888d9d7012a95821`.

## Approved remote setup — 2026-10-22

The user subsequently approved the remote setup plan in this thread. Resources
were re-inspected and the dedicated names were unused. The following now exist
in account `af3e2f28ee93e01e9ad59565728fd47d`:

| Resource | Deployed configuration |
| --- | --- |
| Worker | `topbins`; version `b1731381-a160-4d07-9c26-bd791918b2d9` |
| D1 | `topbins-db`; UUID `af733eb0-3b59-4dee-bcbd-4e64b285de74`; primary ENAM; read replication disabled |
| R2 | `topbins-media`; Standard storage; ENAM; default jurisdiction |
| Images | Worker has the `IMAGES` transformation binding; no hosted Images storage created |

Eastern North America was selected for expected audience latency, not as a legal
data-residency guarantee. No special D1/R2 jurisdiction was requested.
The existing account reports `images.enabled`, `images.transformations_enabled`
and `r2.enabled` as true. Subscription/billing inspection returned 403 because
the OAuth connection cannot access Billing Read. No subscription was purchased
or changed. Deployment accepted the Images binding, but no real transformation
was executed; large-input, color/orientation and failure-path validation remain.

The no-op `0001_baseline.sql` migration was applied remotely, and a subsequent
remote migration listing reported none pending. Only the scaffold Worker and
its two static placeholder assets were deployed, not media or gallery content.
The initial deployment reported **no targets**. Initial read-back verified:

- `workers.dev` disabled and preview URLs disabled;
- no Worker custom domains;
- the dedicated D1, R2, Images and assets bindings;
- R2's managed `r2.dev` domain disabled and no custom bucket domains.

No DNS, Access policy, publisher credentials or other projects' resources were
changed during that initial deployment.

### Confirmed public hostname — 2026-10-22

The user then confirmed **`photos.kocolosk.net`** and authorized landing.
Before attaching it, DNS and Worker-domain lookups found no existing records
for that hostname. Cloudflare's Worker custom-domain API attached it to `topbins`
with hostname routing enabled and preview routing disabled, managing its DNS/TLS.
This did not change Worker code or upload any media.

https://photos.kocolosk.net now serves the scaffold. HTTPS checks verified the
placeholder, CSS, health response, no-store/noindex/security headers, HEAD and
404 responses for unfinished publisher/media routes. `workers.dev`, preview URLs
and public R2 domains remain disabled. This is not a gallery launch.

The ignored remote config includes the hostname so a later approved deployment
preserves it:

```json
"routes": [
  { "pattern": "photos.kocolosk.net", "custom_domain": true }
]
```

Do not add this route to local `wrangler.jsonc` or expose a public R2 domain.

`wrangler.remote.jsonc` was created locally and is ignored by Git. It contains
the above resource identifiers, not secrets; it does not replicate to fresh
worktrees. Recreate it from the local config and the identifiers above when
needed, following step 3 below. `wrangler.jsonc` remains local-only.
Commands used after checks passed:

```sh
CI=true mise exec -- npx wrangler d1 migrations apply DB --remote --config wrangler.remote.jsonc
CI=true mise exec -- npx wrangler deploy --config wrangler.remote.jsonc
mise exec -- npx wrangler d1 migrations list DB --remote --config wrangler.remote.jsonc
```

These commands mutate remote state (except the listing); future deployments and
migrations still need approval for their specific changes. They are not part of
`mise run setup` or CI.

The regular `gh` CLI successfully read this public repository and confirmed
Actions enabled. During preflight, `main` was at the planning commit and was not
protected; no GitHub settings were changed. Hosted CI must pass on the PR head
before landing. GitHub CLI authentication is independent of the failing MCP
grant; `gh` is optional external tooling, not needed by the app/checks and not
currently pinned through mise.

## Local binding contract

| Binding | Role | Local configuration |
| --- | --- | --- |
| `ASSETS` | Static frontend files | `public/`; Worker runs first on all routes |
| `DB` | D1 catalog + separate private publisher tables | `topbins-local`, zero UUID placeholder, `remote: false` |
| `MEDIA` | Private R2 sanitized sources, MP4s, posters | `topbins-local`, `remote: false` |
| `IMAGES` | Managed display transformations on R2 bytes | Images binding, `remote: false` |

`workers_dev` and `preview_urls` are disabled. There is no account ID, custom
domain, route, production database ID or hosted Images storage configuration.
These local names/IDs are **not** resource-creation instructions. `npm run build`
is explicitly `wrangler deploy --dry-run`; it does not prove a remote deployment
will work or authorize one.

### Why the Images binding

Use the [Images binding](https://developers.cloudflare.com/images/optimization/binding/)
rather than hosted Images or a public source URL:

- It accepts a stream directly from a private R2 bucket. The future Worker can
  authorize draft preview or resolve an unlisted capability before reading bytes.
- Hosted Images storage is unnecessary; R2 remains the source of truth.
- The documented binding input maximum is **20 MB**, not the hosted Images
  upload limit. The [limits page](https://developers.cloudflare.com/images/get-started/limits/)
  separately lists 100 MP and 12,000-pixel JPEG limits for URL-based remote/hosted
  images; conservatively respect those too and verify binding behavior.
  Reported <20 MB, 24/32 MP sources fit these documented limits, but this is not
  proof that every export will transform successfully.
- Use a conservative preflight ceiling no greater than **20,000,000 bytes**
  for sanitized JPEG/poster bytes, and reject unsupported dimensions before
  upload. Ingestion must verify managed transformation success before first
  publication; oversized inputs must fail with actionable export guidance.
- Initial proposed presets are 640×640 grid and 2560×2560 viewer bounding boxes,
  scale-down without crop/upscale. Negotiate AVIF/WebP/JPEG with correct Accept
  handling and representation-specific cache keys. No arbitrary URL parameters.

Local Images simulation has limited fidelity and does not prove scale-down,
color/orientation, large-input or production encoding behavior. Current tests
only verify the binding exists. After approval and account setup, validate real
managed transformations using explicitly approved non-private fixtures, including
inputs over 10 MB and near-limit inputs, orientation, ICC color and failures. Do not
silently publish assets that cannot produce their display variants.

The binding requires an eligible Images entitlement. The current
[pricing page](https://developers.cloudflare.com/images/pricing/) offers
transformations of externally stored images on Free and Paid plans: 5,000 unique
transformations/month are included; Free rejects new transformations beyond the
limit, while Paid adds $0.50 per 1,000 unique transformations. An older tutorial
still calls for Paid; do not purchase hosted storage on that basis. This account's
binding deployment succeeded with its existing entitlements. Actual subscription
and billing details remain unverified; no subscription was purchased here.

### Access, caching and video

Keep R2 private: no `r2.dev`, public custom bucket domain, public list operation,
or public metadata containing keywords/original filenames. Do not make the
source bucket public to simplify transformations. Use opaque versioned keys.

The Worker must resolve publication/visibility before any source or cache access.
Draft preview/publisher routes require authentication and no-store; no viewer
login is needed for published public or random-capability unlisted galleries.
Never expose raw D1 rows or publisher-only metadata. Published unlisted URLs
are shareable, not identity-private; prevent enumeration and request noindex.

Images binding responses are not automatically cached. Add explicit cache policy
and the Workers Cache API when media routes are implemented; account for preset,
source version and output format. Do not cache draft responses or errors as
public assets. Stable media pages and versioned asset URLs are separate concepts.
The scaffold intentionally caches nothing.

Downloads must stream the largest sanitized uploaded JPEG or published MP4
directly from R2, with conditional requests and download headers, never an image
variant. Video streaming must honor byte ranges (including 206/416), seek and
avoid buffering full files in Worker memory. H.264, 8-bit SDR, AAC when present;
1080p recommended but compatible 4K allowed. Probe/remux/poster generation is
local, preserves audio, and has no mute feature or server-side transcoding.
None of these media routes/processors exists yet.

## Approval-gated remote setup

**Ask the user before provisioning, subscriptions, remote migrations, deployments,
DNS changes or publishing media.** The setup recorded above was approved in the
thread; this checklist does not itself authorize future changes.

Once the specific changes are approved:

1. Re-inspect the intended account and resource names. Propose a dedicated
   `topbins` Worker, `topbins-db` D1 database and `topbins-media` private R2
   bucket; verify availability and choose jurisdiction/location deliberately.
   Do not reuse resources belonging to other projects. If staging is needed,
   provision separate staging resources rather than pointing local dev at prod.
2. Confirm Images binding eligibility, quotas and billing. No hosted Images,
   Stream, queues or Durable Objects are required.
3. Copy `wrangler.jsonc` to the ignored `wrangler.remote.jsonc` for initial
   approved setup. Replace the placeholder D1 UUID, database/bucket names and
   add the intended account ID and the confirmed custom-domain route above.
   Keep local config unchanged. `remote: false`
   controls local emulation, not deploy-time binding permissions.
   Use `--config wrangler.remote.jsonc` explicitly for any approved remote
   operation; `wrangler deploy` without `--dry-run` really deploys.
   Apply reviewed migrations to the correct D1 only with explicit `--remote`.
4. Select publisher/preview authentication before adding any write/preview
   routes. Recommended direction: Cloudflare Access protecting a dedicated
   publisher path/hostname with service-token CLI credentials and authenticated
   human previews. The Worker must validate Access JWTs/audience, not merely
   trust spoofable headers. Final policy and CLI token storage are deferred.
5. Supply deployment credentials via `mise exec -- npx wrangler login` (OAuth
   stored outside the repository) or a narrowly scoped `CLOUDFLARE_API_TOKEN`
   in the invoking process environment/approved secret manager. Account IDs
   and resource IDs are identifiers, not credentials. Scope permissions to
   intended Workers/assets, D1 and R2; review any Images/zone permissions needed.
   Never paste secrets into commands saved to history, committed config, issue
   text, or logs. Future runtime secrets use Wrangler's interactive `secret put`
   with the explicit remote config. Local-only runtime secrets may be placed
   manually in ignored `.dev.vars`; never in static assets or public env vars.
   No application secret is needed for this scaffold.
6. The confirmed subdomain is `photos.kocolosk.net`, already attached to the
   Worker. Keep `workers.dev`/preview URLs disabled unless separately approved.
   Changing or adding a Worker custom domain can itself change DNS and requires
   approval for that specific change.
7. Validate transformations, sanitization/privacy, unlisted/draft behavior,
   source downloads, browser video seeking, backup/export and SPEC acceptance
   checks before real publication. Approve credit, usage terms and contact.

The current GitHub workflow has no deployment credentials or deploy step.
Any future deployment workflow needs a separately approved environment,
least-privilege secrets, migration strategy and release gate. GitHub Actions
must pass for the exact PR head before landing; repository inspection found
Actions enabled and `main` unprotected. Changing branch protection needs
separate approval.

## Limits, costs and recovery

Track current [Workers](https://developers.cloudflare.com/workers/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/),
[R2](https://developers.cloudflare.com/r2/pricing/), and
[Images](https://developers.cloudflare.com/images/pricing/) pricing before launch.
Cost drivers include dynamic Worker requests/CPU, D1 reads/writes/storage, R2
storage and operations (especially large MP4s), and managed transformations/
chosen plan. Source version and distinct transformation geometry/options influence
billed unique transformations; current Images pricing excludes format and quality
from uniqueness. Output formats still need separate cache representations.
Lack of caching adds latency/work. Do not promise free operation.

Confirm actual account quotas and Worker request-body limits before designing
resumable uploads; large videos likely need authorized multipart/direct-upload
flows rather than a single buffered Worker request. Media limits, upload protocol
and cache TTLs remain implementation work, not implicitly configured here.

D1 and R2 are not the publisher's only archive. Catalog/private-metadata export,
source recovery, interrupted-import reconciliation and deletion policy must be
documented and exercised before publication. Private exports must never go to
public assets, Git or CI artifacts. No backup/recovery capability is claimed by
the scaffold.
