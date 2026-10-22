# topbins

Cloudflare-native sports photo/video gallery. [SPEC.md](SPEC.md) is the product
and architecture baseline. This repository currently contains **scaffolding only**:
no gallery, media ingestion, sanitization, authentication, preview, or publishing.
No private sample media are included or required.

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
`/` is a placeholder page. Everything else except `/style.css` returns 404.
Stop development with Ctrl+C. No Cloudflare login or credentials are needed.
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
| `mise exec -- npm run cli -- --help` | Publisher CLI scaffold help |
| `mise run check` | Generated types, typechecking, lint, format, tests, dry-run build |

`doctor` exits nonzero for missing, broken or timed-out tools with a mise recovery
instruction. It is a tool-execution check, not a media compatibility or
sanitization test. Persistent failures must be investigated, not bypassed.
Never point tests at private exports to make checks pass.

Local state lives in ignored `.wrangler/state/`; Vitest uses isolated ephemeral
storage and does not reuse that development state. The baseline migration is
intentionally a no-op, recorded by Wrangler's migration ledger. Add forward-only
numbered migrations when implementing the catalog; do not edit applied migrations.
The product schema has deliberately not been invented as part of tooling.

## Stack and layout

- `src/worker.ts`: ES-module TypeScript Worker, minimal liveness endpoint and
  explicit static asset allowlist. All responses currently use no-store and
  noindex. No open R2 proxy, SPA fallback, or unfinished publisher endpoint.
- `public/`: deployable static placeholder. Wrangler bundles the Worker and
  uploads assets, so no second bundler or framework is necessary yet.
- `cli/`: Node 24 native TypeScript entry point, isolated from Worker types.
  Future local-folder publishing lives here, not in the browser.
- `migrations/`: D1 migrations; future team → season → match catalog and separate
  publisher-only metadata tables.
- `test/`: Vitest using Cloudflare's current `@cloudflare/vitest-plugin` in
  workerd, plus Node-based CLI diagnostics tests. D1 migrations, R2 round-trip,
  static assets, route denial, headers and HEAD behavior are exercised.
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

Still to implement under the spec:

- Catalog, public/unlisted visibility and non-enumeration; authenticated draft
  preview and publisher operations. No viewer sign-in.
- CLI manifest, repeatable/resumable uploads, private keyword extraction,
  sanitization and explicit stable-ID source replacement.
- Approved display presets with format negotiation and versioned cache keys;
  exact sanitized JPEG downloads. No pregenerated photo variants.
- Direct-play H.264/AAC MP4s, local probe/remux/poster processing preserving
  audio, and streamed range-aware R2 serving. No server transcoder or mute flag.
- Actual gallery UI, rights/contact approval, recovery/export and launch checks.

The SPEC acceptance checklist is **not** satisfied by scaffold checks.
