---
name: land
description: >-
  Publish finished changes to kocolosk/topbins through a pull request, watch its
  checks and review comments, and merge once everything is green and resolved.
  Use after completing a change that is meant to land, or when the user asks to
  land or merge. Not for review-only, exploratory or unfinished work.
---

# Land topbins changes

## Scope and authorization

Applies only to `kocolosk/topbins`, with `origin` as the destination and `main`
as the base. During early development the user prefers speed: finishing a
requested change authorizes the whole flow below (push the branch, open a PR,
address feedback, merge) without asking again. Before starting, inspect
`origin` and confirm it still identifies that repository. If scope or
destination is ambiguous, stop and ask.

This authorizes **landing code only**. It never authorizes production
deployment, remote migrations, Cloudflare/Zero Trust or GitHub settings changes,
branch-protection changes, or publishing media. Those still need explicit
approval for the specific change (see `AGENTS.md`). Merging to `main` does not
deploy production; say so in the PR if a change needs a manual deploy or remote
migration afterward, and leave that to the user.

## Prepare

1. Read `AGENTS.md`. Inspect the working tree, current branch and divergence
   from `origin/main` (`git fetch` first). Do not assume every changed or
   untracked file belongs to this change; never stash, reset or discard
   unrelated work.
2. Work on a descriptively named feature branch cut from current `origin/main`
   (never commit directly to `main`). Reuse an existing branch/PR for the same
   change instead of opening a duplicate.
3. Stage only in-scope paths, with no blanket `git add -A`. Exclude private
   media, credentials, generated files and local config such as
   `wrangler.remote.jsonc`, `.dev.vars` and `.claude/`. Scan the staged diff
   for secrets and run `git diff --cached --check`.
4. Run `mise run check` (the same command CI runs; see `mise.toml`) and, for
   changes touching the CLI, media or demo, `mise exec -- npm run demo -- --smoke`.
   Use the pinned mise tools, not ambient ones. Docs-only changes can skip the
   full check but should still have the diff inspected.
5. Commit with an explicit message (use `GIT_EDITOR=true` and `-m`/`-F` so no
   editor opens) and end it with the attribution line from the session context.

## Publish

Push the branch to `origin` with a normal non-force push, then open a PR into
`main` with `gh pr create` and an explicit title and body (no editor). The body
states what changed, the checks actually run locally, anything not validated,
any manual follow-up (deploy, remote migration, secret, Access/Cloudflare
change), and the preview URL when relevant. Do not claim checks or previews that
did not run. Never force-push or rewrite published history; add commits instead.
After a PR head changes, earlier verification no longer applies.

## Watch the PR

Poll with bounded commands (`gh pr checks`, `gh pr view --json`) or schedule a
wake-up; do not block indefinitely. Re-check after every push.

- **Failing checks.** Read the logs (`gh run view --log-failed`), fix the cause,
  push, and wait again. Do not disable, skip or weaken a check, or merge around
  a failure. If a failure is flaky or external and not caused by the change,
  rerun once and report it. If you cannot fix it, stop and tell the user.
- **Review comments.** Read all inline comments and reviews (`gh api
  repos/kocolosk/topbins/pulls/<n>/comments` and `/reviews`), including
  Copilot's, and decide on the merits: fix valid findings with a regression test
  where sensible; reply with a short reason when declining. Resolve each thread
  once addressed or answered. A human reviewer's change request is not dismissed
  by the agent: fix it or ask the user.
- **Cloudflare preview.** The Workers Builds check deploys a branch preview
  (`docs/pr-previews.md`). It must succeed for the current head. Previews use
  empty shared staging storage with publishing and draft preview disabled, so
  say plainly what a preview can and cannot exercise.

## Preview notification vs. merging

Decide whether the change has a **meaningful preview**: user-visible gallery,
page, viewer, styling or public-route behavior a person can try in the browser.
Docs, tests, tooling/CI, dependency bumps, and API/CLI/auth changes that a
preview cannot exercise are not meaningful previews.

- **Meaningful preview:** once checks pass and comments are resolved, tell the
  user the preview URL, what to try, and what the preview cannot show. Do not
  merge until they say it is good.
- **Otherwise:** merge as soon as all checks pass for the current head and all
  review threads are resolved.

## Merge

1. Re-fetch and confirm the head SHA you verified is the PR head, all required
   checks passed for that exact head, and no unresolved threads remain.
2. Squash-merge pinned to that head:
   `gh pr merge <n> --squash --match-head-commit <sha>`. Check `gh pr merge
   --help` for current flags; use a different strategy only if repository rules
   require one. Never use administrative bypass, and never change protections or
   settings to make a merge succeed. `main` is currently unprotected, so CI
   passing is the gate by convention.
3. Verify the PR shows `MERGED` and the merge commit is reachable from
   `origin/main`.
4. If the user's checkout is on a clean `main` or on the merged feature branch
   with nothing uncommitted, fast-forward it (`git merge --ff-only`); otherwise
   leave it alone and say so. Do not delete the user's branches.

## Stop and ask

Pause, report, and wait for the user when: the base moves and integrating causes
**any merge conflict** (do not resolve even simple conflicts automatically;
report the paths and the in-progress state, and preserve unrelated work); a
required check fails and you cannot fix it; scope is ambiguous; a change would
need approval-gated infrastructure, secrets, or media work; or something unsafe
or unverifiable appears. A PR that has been created is not a landed change:
report truthfully whether it is merged, waiting on checks, or waiting on the
user.
