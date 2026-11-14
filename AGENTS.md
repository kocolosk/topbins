# Working on topbins

- Read `SPEC.md` first. It is the product/architecture baseline; `README.md`
  describes the current scaffold and exact development commands.
- Use `mise install --locked node conda:ffmpeg conda:exiftool`,
  `mise run setup`, `mise run check`, and
  `mise exec -- npm run doctor`. Do not depend on ambient Homebrew media tools.
- `wrangler.jsonc` is local-safe. Do not enable remote bindings, provision
  resources, deploy, change DNS, or publish media without explicit user approval.
  See `docs/cloudflare.md` for the intended binding/access contract.
- No viewer sign-in; authenticated publishing/preview is separate. Keep private
  metadata out of public responses, static assets, R2 metadata and downloads.
- Do not copy, commit, publish or use private media samples without approval.
  Tests should use synthetic, non-identifying fixtures.
- Regenerate `worker-configuration.d.ts` with `npm run types:generate` after
  Wrangler config changes. Add forward-only D1 migrations; never edit an applied
  migration. Keep Node CLI code and Worker code in their separate type environments.
- Changes to tooling should keep local and CI commands aligned.
- Landing is automatic for finished changes: follow
  `.agents/skills/land/SKILL.md` to push a branch, open a PR, handle failing
  checks and review comments, and merge once checks pass and threads are
  resolved (for changes with a meaningful preview, ask the user to try it
  first). This covers code only. Production deploys, remote migrations,
  Cloudflare/GitHub settings, and publishing media still need explicit approval.
