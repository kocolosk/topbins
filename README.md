# topbins

Cloudflare-native sports photo/video gallery. [SPEC.md](SPEC.md) is the product
and architecture baseline. The first **local, photo-only publishing slice** is
implemented: folder import, JPEG sanitization, a D1 catalog, authenticated draft
preview, public/unlisted galleries, managed display sizes, and source downloads.
Video and production launch work remain. No private sample media are included
or required.

## Quick start

Prerequisites: Git, a supported macOS/Linux host, and
[mise](https://mise.jdx.dev/getting-started.html) **2026.9.12** (the CI version).
Install mise separately using its official instructions; the tool manager cannot
bootstrap itself from this project's tool configuration. Do not repair or depend
on Homebrew FFmpeg/FFprobe.

From the repository root:

```sh
mise trust
mise install --locked node conda:ffmpeg conda:exiftool
mise run setup
mise exec -- npm run doctor
mise run check
mise run dev
```

Open http://127.0.0.1:8787. `GET /api/health` returns `{"status":"ok"}`;
`/` shows public teams, or an empty state until a match is published locally.
Stop development with Ctrl+C. No Cloudflare login or credentials are needed for
setup/checks or browsing. Publishing and draft preview require a local token.
Installation downloads public tool packages; the app, tests, D1 and R2 run locally.
Do not use `wrangler dev --remote` or set bindings to `remote: true` casually.
The explicit tool list scopes installation to this project, avoiding attempts
to install unrelated tools inherited from personal/ancestor mise configurations.

The lockfile covers macOS ARM64 and Linux x64 (CI). Other supported mise platforms
need a reviewed lockfile extension with
`mise lock --platform macos-arm64,linux-x64,<your-platform>` before locked install;
they have not been validated. Conda-forge supplies isolated FFmpeg/FFprobe and
ExifTool environments, including their libraries and Perl. No separate conda,
Homebrew libraries, or system Perl installation is needed. Normal host OS/runtime
libraries are still required; these are not fully hermetic containers.

## Daily commands

Use `mise exec --` for npm commands unless your shell already activates mise.
Do not rely on a globally installed Wrangler or media tool.

| Command | Purpose |
| --- | --- |
| `mise run setup` | `npm ci`, then local D1 migrations without an interactive prompt |
| `mise run dev` | Wrangler local Worker, assets, D1, R2 and offline Images simulation |
| `mise exec -- npm run db:migrate` | Apply migrations to local D1; may ask for confirmation |
| `mise exec -- npm test` | Worker-runtime integration tests and Node CLI tests |
| `mise exec -- npm run typecheck` | Strict Worker and separate Node CLI TypeScript checks |
| `mise exec -- npm run types:generate` | Regenerate committed runtime/binding types after config changes |
| `mise exec -- npm run types:check` | Fail if generated types are stale |
| `mise exec -- npm run lint` | Biome source lint |
| `mise exec -- npm run format` | Format supported source/config files |
| `mise exec -- npm run format:check` | Check formatting without writes |
| `mise exec -- npm run build` | Wrangler bundle/static-assets dry run; **does not deploy** |
| `mise exec -- npm run doctor` | Execute ExifTool, FFmpeg and FFprobe version probes |
| `mise exec -- npm run cli -- --help` | Publisher CLI usage |
| `mise run check` | Generated types, typechecking, lint, format, tests, dry-run build |

`doctor` exits nonzero for missing, broken or timed-out tools with a mise recovery
instruction. It is a tool-execution check, not a media compatibility or
sanitization test. Persistent failures must be investigated, not bypassed.
Never point tests at private exports to make checks pass.

Local state lives in ignored `.wrangler/state/`; Vitest uses isolated ephemeral
storage and does not reuse that development state. The baseline migration is
intentionally a no-op; subsequent migrations add the catalog and team-scoped
seasons. Add forward-only numbered migrations; do not edit applied migrations.

## Import and preview a match locally

Follow [the publishing CLI guide](docs/publishing-cli.md) for the JSON manifest,
credential setup, metadata/profile policy, and retry/replacement behavior:

```sh
mise exec -- npm run cli -- import ./exports --manifest ./match.json --endpoint http://127.0.0.1:8787
```

The first import creates a draft. Open the returned `/preview/...` URL and use
username `publisher` with your local publisher token as the password.
Add `--publish` to expose the album in your **local** gallery. Re-importing a
published album without that flag preserves its publication state. The CLI
rejects non-loopback endpoints in this slice.

## Stack and layout

- `src/worker.ts`: routes to explicit catalog, publisher, media, and site handlers.
  Catalog reads apply visibility and media projection in one database statement.
  No open R2 proxy or SPA fallback.
- `src/pages.ts` / `src/site.ts`: server-rendered team/season/match pages and
  authenticated preview. All pages remain no-store/noindex during this local
  implementation phase.
- `public/`: CSS and progressive photo-viewer JavaScript. Pages and source
  downloads work without JavaScript; the viewer adds modal, touch, keyboard, and
  individual-link behavior. No additional frontend framework or build tool.
- `cli/`: Node 24 native TypeScript entry point, isolated from Worker types.
  ExifTool sanitizes temporary copies without modifying source exports.
- `migrations/`: D1 migrations; team → season → match catalog and separate
  publisher-only metadata tables.
- `test/`: Vitest using Cloudflare's current `@cloudflare/vitest-plugin` in
  workerd, plus Node-based CLI and rendering tests. Synthetic JPEG tests execute
  the pinned media tools and verify pixel equality, metadata removal, private
  keyword retention, profile handling, stable IDs, retry, and replacement.
- `wrangler.jsonc`: local-safe binding source of truth. `worker-configuration.d.ts`
  is generated and committed, never manually edited.
- `mise.toml` / `mise.lock`: exact Node/media-tool versions and resolved
  platform-specific packages/checksums. npm is the version bundled with Node;
  npm dependencies are exact-pinned with `package-lock.json`.

Wrangler, TypeScript, Vitest and Biome are project npm dependencies rather than
duplicated mise tools. This keeps JavaScript tooling in one dependency graph.
Git, mise itself, the host OS, and a browser are the externally supplied tools.
Biome intentionally excludes Markdown to preserve the landed spec/instructions;
SQL, TOML, YAML and prose are reviewed separately, not claimed as linted/formatted.

CI runs installation, local migrations, real media-tool version probes and the
same `mise run check` on Ubuntu, with read-only repository permission, no
Cloudflare secrets and no deploy job. It also checks for tracked-file drift.
Actions are SHA-pinned; Dependabot proposes npm and Actions updates. Toolchain
updates require changing pins, regenerating both locks/types as appropriate, and
running the documented checks. For mise lock updates:

```sh
mise lock --platform macos-arm64,linux-x64
```

## Cloudflare and implementation boundaries

See [docs/cloudflare.md](docs/cloudflare.md) for read-only account findings,
binding choices, transformation limits, costs, secrets and approval-gated setup.
There is intentionally no automated deployment script.
The approved scaffold is available at https://photos.kocolosk.net with dedicated
D1/R2 resources. Only the placeholder is public: `workers.dev`, preview URLs and
public bucket domains remain disabled. No gallery or media has been published.
The ignored machine-local remote config is separate from the local dev config;
see the remote setup record for identifiers and verification. Local setup/checks
still require no Cloudflare credentials.

Remaining work under the spec:

- Production publisher authentication review, remote publishing transport,
  launch policies, approved deployment, and real managed Images validation.
- Approval of additional embedded ICC profiles before importing exports that
  contain them. Unknown profiles fail closed rather than leak embedded text or
  change colors by assigning another profile.
- Direct-play H.264/AAC MP4s, local probe/remux/poster processing preserving
  audio, and streamed range-aware R2 serving. No server transcoder or mute flag.
- Explicit deletion/unpublishing UX, complete catalog/asset backup and recovery,
  rights/contact approval, and real-device launch checks.

The authenticated API exports each album's private metadata; a full-site export
and recovery command is not implemented. See [the API contract](docs/publishing-api.md).
The full SPEC acceptance checklist is **not** satisfied by these local checks.
