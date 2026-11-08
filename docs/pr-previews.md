# Pull request previews

Cloudflare **Workers Builds** watches `kocolosk/topbins`, matching the integration
used by `nefc-soccer-profiles` and `college-recruiting-tracker`. Pushes to
non-`main` branches build and deploy a branch-named **Worker Preview**. Cloudflare
posts build status and Preview links on associated PRs. Branches without an open
PR also build; this is a branch integration, not a PR-only GitHub workflow.

Each Preview has a stable branch URL and each successful deployment has an
immutable deployment URL. Cloudflare generates hostname-safe slugs, so
`feature/gallery` need not be renamed in Git. The deployment script uses the
URLs Cloudflare returns, not guessed hostnames.

## Resources and access

Approved shared staging resources in account `af3e2f28ee93e01e9ad59565728fd47d`:

| Resource | Name / identifier |
| --- | --- |
| Preview parent Worker | `topbins-preview` / `c29d99991b1e47e7a07ef8977fc797f4` |
| D1 | `topbins-staging-db` / `97ca691a-1ffc-440d-994a-04ea078c800b` |
| Private R2 | `topbins-staging-media` |

The separate parent keeps production `topbins`, its disabled version URLs and
`photos.kocolosk.net` unchanged. The preview parent has no production endpoint or
custom domain. `wrangler.preview.jsonc` contains identifiers only and must be
selected explicitly for preview operations. `wrangler.jsonc` stays local-safe.
Never run `wrangler deploy` with the preview config; use `wrangler preview`.

All Previews share staging data. It starts empty: no production data or private
media are copied or seeded automatically. Only synthetic, non-identifying test
data may be added. R2 has no public bucket domain or listing; published assets
go through Worker publication checks. Published gallery browsing needs no login.

The preview config binds an empty `PUBLISH_TOKEN`, and deployment uses
`--ignore-base-config`. Publisher writes and authenticated draft previews are
unavailable. Do not add production secrets to this parent or its Previews.
These environments run trusted branch code, not a sandbox for hostile code.
GitHub still checks fork PRs; do not configure credentialed Cloudflare builds
for untrusted forks.

## Cloudflare build settings

The repository connection was configured and read back on 2026-11-08. Credentials
stay in Cloudflare: **no Cloudflare secret is needed in GitHub**. The connection
uses the account's existing stored Workers Builds token; no token secret was
retrieved or copied, and no existing token permissions were changed. That token
must permit Worker/asset deployment and the read-only staging D1 migration query.
If the first hosted build reports an authorization error, choose a suitable
token in this Worker's **Settings > Builds**, preferably dedicated to this project
rather than broadening a token shared by other projects.

| Setting | Value |
| --- | --- |
| Worker | `topbins-preview`, not production `topbins` |
| Git repository | `kocolosk/topbins` |
| Base/production branch | `main` |
| Preview builds | Enabled, native Worker Previews |
| Preview build command | `sh scripts/cloudflare-build.sh` |
| Preview deploy command | `sh scripts/cloudflare-deploy.sh` |
| Root directory | `/` |
| Build variable | `SKIP_DEPENDENCY_INSTALL=1` |
| Build variable | `NODE_VERSION=24.15.0` |
| Build variable | `WRANGLER_SEND_METRICS=false` |
| `main` build command | `printf 'Production deployment is manual; nothing to deploy.\n'` |
| `main` deploy command | `true` (no-op) |

The no-op `main` commands are intentional: this connection must not roll code to
production, or create a production endpoint on the preview parent. GitHub CI
still checks `main`. Do not replace the no-op with `wrangler deploy` without
separate production authorization.

`cloudflare-build.sh` bootstraps mise **2026.9.12**, the same release as GitHub CI,
from a pinned Linux-x64 archive and verifies its SHA-256 before execution. It
uses ignored `.wrangler/build-tools/` so the deploy command can use the same mise
binary in a new shell. Dependency auto-install is disabled in Builds; mise
installs the locked Node, FFmpeg and ExifTool versions before `mise run setup`.
The image's ambient media tools and npm version are not used.

## Checks and deployment

GitHub Actions remains read-only, credential-free CI. It runs in parallel with
Workers Builds, not as an upstream dependency. To retain a check-before-deploy
gate without GitHub credentials, **Cloudflare repeats the full checks**:

1. Install the locked toolchain and run `mise run setup`.
2. Run `mise exec -- npm run doctor`, `mise run check`, and tracked-file drift checks.
3. Verify the checkout matches `WORKERS_CI_COMMIT_SHA` and the branch is not `main`.
4. Read staging D1's migration table; fail if this branch has unapplied migrations.
5. Deploy with `wrangler preview`, using `WORKERS_CI_BRANCH` as the name and
   the full commit SHA as the tag.
6. Probe the immutable deployment: health, D1-backed catalog, homepage, stylesheet,
   denied publisher write and denied authenticated draft preview.

A failed check or migration gate prevents deployment. A failed post-deploy probe
marks the build failed but does not undo the Cloudflare deployment. Inspect the
build logs and fix forward or retry a compatible commit.

Cloudflare may run branches concurrently. It also skips superseded queued builds
when a newer commit is queued for the same trigger. Thus every push triggers
build processing, but rapid pushes are not guaranteed one deployment per commit.
Failed or superseded builds do not produce a successful deployment.

## Shared staging migrations

**Individual Preview builds never apply remote migrations.** There is no
GitHub concurrency queue or distributed lock in this architecture. Instead,
apply a reviewed staging migration once as an explicit operation, then retry
affected builds:

```sh
CI=true mise exec -- npx wrangler d1 migrations apply DB --remote --config wrangler.preview.jsonc
```

Serialize these operations yourself; do not invoke migrations from multiple
parallel builds. Migration `0001`–`0003` was applied during initial setup.
The preview gate reads `d1_migrations` without modifying it. Older branches may
run against a newer staging schema; use backward-compatible expand/contract
changes. Never rewrite an applied migration or reset staging on branch cleanup.

## Cleanup and recovery

Use Cloudflare's native branch lifecycle: keep `auto_delete` enabled for each
Preview, so deleting its Git branch removes the Preview and deployment history.
**Closing a PR alone is not branch deletion.** Delete the source branch after
merging or abandoning it, or explicitly delete its Preview:

```sh
mise exec -- npx wrangler preview delete --config wrangler.preview.jsonc --name feature/gallery --skip-confirmation
```

This never deletes shared D1/R2 storage or the parent Worker. There is no
credentialed GitHub cleanup workflow. A recreated branch can recreate a Preview.
If you keep a branch after closing its PR, its Preview remains live until
explicitly deleted. Verify `auto_delete` in Cloudflare after the first branch
Preview is created.

For an approved manual Preview deployment or probe:

```sh
mise exec -- npx wrangler preview --config wrangler.preview.jsonc --name feature/gallery --ignore-base-config --json
mise exec -- node scripts/check-preview.mjs https://<immutable-deployment-url>
```

## Verification record

Initial staging setup on 2026-11-08 deployed a temporary Preview twice and
verified a stable branch URL, different deployment URLs and passing route probes.
It then deleted the Preview and verified storage remained and public R2 domains
were disabled. Production routing remained disabled; no media were uploaded.

The subsequent switch configured the native Workers Builds repository connection
and enabled Worker Previews. The new deployment script was also executed locally
with a synthetic Builds context against staging: its read-only migration gate,
deployment and immutable-URL route probes passed, and the temporary
`ci/builds-validation` Preview was removed. This used local Wrangler OAuth, not
the stored Builds token.

The build/deploy scripts must be published before
Cloudflare can execute them. The first hosted build, stored build token's D1
permissions, PR comment, Linux bootstrap, and branch-deletion cleanup still need
end-to-end verification; local tests are not evidence of those hosted behaviors.
