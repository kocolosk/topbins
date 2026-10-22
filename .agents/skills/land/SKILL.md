---
name: land
description: >-
  Land explicitly requested changes in kocolosk/topbins through verified branches
  and pull requests, with a one-time initial repository bootstrap. Invoke only
  when the user requests landing or merging, not for review, preparation,
  passing checks, or skill installation.
disable-model-invocation: true
metadata:
  delta-action: land
---

# Land topbins changes

## Scope and authorization

Apply only to the `kocolosk/topbins` repository. An explicit request to land or
merge, including `/land`, authorizes this workflow: proceed through verification
and landing without asking for the same permission again. Skill installation,
review approval, or passing checks alone do not authorize landing.

The destination is `main` on GitHub at `kocolosk/topbins`, using `origin`.
Inspect remotes before publication and confirm that `origin` still identifies
that repository. Never publish through `local`, the user's checkout backlink.
If the destination or requested scope is ambiguous, stop and ask.

## Preflight

1. Read applicable `AGENT.md`/`AGENTS.md`, contribution policies, submission
   templates, and relevant scripts. Honor applicable signing, authorship,
   review, documentation, and other contribution obligations. Do not substitute
   generated text for human-authored submission text if policy requires it.
2. Inspect the working tree, index, current branch, history, and remote refs.
   Account for both uncommitted changes and commits already prepared for this
   request. Do not assume that all changed or untracked files belong to it.
3. Review the intended diff. Stage only in-scope paths; do not use blanket
   staging. Preserve unrelated staged and unstaged work. If that cannot be
   done safely, stop rather than stash, reset, overwrite, or discard it.
4. Exclude sample photos/videos and other private media unless explicitly
   requested. Check for credentials and unintended generated files.
5. Verify required tools and authentication without exposing credential values.
   Use the available `git` and `gh` commands; check help before relying on
   wrapper-specific or previously unverified arguments. Use non-interactive
   commands. Prefix commits or merges that could open an editor with
   `GIT_EDITOR=true` and provide explicit commit messages.
6. Inspect current repository settings, rulesets, destination branch protection,
   and CI requirements. GitHub API access through `gh api` was verified during
   setup. Do not interpret a permission error or an unverifiable rule as an
   absence of requirements.

Useful read-only GitHub queries, supported by the inspected `gh api` interface:

```sh
gh api repos/kocolosk/topbins
gh api repos/kocolosk/topbins/rulesets
gh api repos/kocolosk/topbins/branches/main/protection
```

A missing branch is expected only when remote refs confirm that the repository
is still empty. Never change protections, permissions, or repository settings
to make landing succeed.

## Verification

At setup, the repository contained `SPEC.md` but no application manifest,
test/build definitions, CI workflows, or toolchain configuration. Do not invent
commands such as `mise run test`, or claim application tests passed when none
exist.

- For documentation/setup-only changes while no verification tasks exist,
  inspect the full staged diff and run `git diff --cached --check`. Validate
  changed structured configuration, including skill frontmatter, with available
  suitable tooling. Report absent checks plainly.
- As implementation is added, inspect actual manifests, task definitions, and
  CI workflows before selecting commands. Record a repository-relative source
  reference establishing each exact project-specific invocation in the landing
  report. Prefer configured, pinned `mise` tools; do not silently substitute
  ambient tool versions. Follow the toolchain preference in `SPEC.md`,
  section 8, "Local tooling."
- Keep local verification proportional to the change unless repository policy
  requires more. A representative local run does not replace required CI.
- Verify that **all required checks have passed for the exact changes being
  landed**, including applicable PR-head or merge-candidate checks. Pending,
  failing, missing, stale, or unverifiable required checks block landing.
- Any modification or conflict resolution invalidates affected verification;
  rerun it and wait for fresh required results.

## One-time empty-repository bootstrap

Use this exception only when both local history and remote refs establish that
the repository has no commits. If remote history now exists, use the ordinary
pull-request path instead.

1. Limit bootstrap to the requested initial documentation/setup changes.
   Application changes are not covered by this direct-push exception.
2. Complete applicable verification, including staged-diff review and checks.
3. Create an initial commit on `main`, with an explicit descriptive message,
   respecting configured signing requirements.
4. Recheck remote refs immediately before pushing. If another actor has
   initialized the repository, stop; do not overwrite or force-push.
5. Push `main` to `origin` with a normal non-force push and verify the resulting
   remote commit. If rules prohibit bootstrap publication, report the blocker
   rather than bypassing them.

Once `main` exists, do not use this exception again.

## Ordinary branch and pull-request landing

1. Fetch the destination and inspect divergence and the intended commit range.
   Preserve unrelated work and do not rewrite published history.
2. Prepare a descriptive feature branch containing only the requested changes.
   Reuse an existing appropriate branch/PR rather than creating duplicates.
   Make any necessary commits with explicit messages after verification.
3. Publish the branch to `origin` using a normal push, then create or update
   its pull request targeting `main` in `kocolosk/topbins`. Check the installed
   CLI's supported flags before execution; do not assume every upstream
   subcommand is implemented by a local wrapper. Use explicit title/body text,
   respecting submission policy and templates, rather than an interactive editor.
4. Summarize the change, actual verification, and any applicable preview URL in
   the PR. Do not claim tests or previews that did not run.
5. Reconcile with destination updates only through a non-destructive workflow.
   If integration introduces any conflict, follow the conflict policy below.
6. Obtain applicable required reviews and verify all required CI results for
   the current changes. If they are pending, wait with bounded commands or
   report that landing remains pending; do not treat PR creation as completion.
7. Squash-merge the verified PR when allowed by current rules, pinning the
   operation to the verified head where the API/tool supports it. Check the
   head again before merging. If current rules require a different merge
   strategy or a merge queue, follow that requirement and verify its required
   checks rather than bypassing it.
8. Verify that the PR is merged and its resulting commit is reachable from
   remote `main`. A published branch, approved PR, queued merge, or enabled
   auto-merge is not successful landing.

Never force-push, disable checks, override protections, use administrative bypass,
or merge a stale version whose required checks do not apply.

## Cloudflare previews

Cloudflare branch previews are intended but were not configured at skill setup.
Do not invent a deployment command, configure infrastructure, or require a
nonexistent preview for the documentation-only bootstrap.

Once preview integration exists:

- Inspect its actual configuration and determine which checks/deployments
  correspond to the PR head.
- For application changes, obtain the branch preview URL, include it in the PR,
  and verify that the deployment succeeds for those changes before merging.
- Validate relevant behavior through the preview when feasible; report any
  access or testing limitation. A successful deployment alone is not proof that
  the application behaves correctly.
- Respect documented docs-only exemptions.
- Stop if an applicable required preview fails, is missing, or cannot be
  verified. Do not replace it with an older deployment or a production URL.

Landing does not independently authorize manual production deployment, gallery
publication, media upload, or infrastructure mutations. A configured automatic
deployment resulting from merge follows the repository's normal integration.

## Conflicts and safeguards

The user's explicit preference is to **pause on every merge conflict**.

Do not resolve even apparently straightforward conflicts automatically. Report
the operation, conflicting paths, and why the changes have not landed, then wait
for the user's decision. Preserve unrelated work and explain any in-progress
Git operation; do not perform destructive cleanup.

Also stop for ambiguous scope, unavailable permissions, unsafe changes, unmet
contribution requirements, or failed/unverifiable required checks.

## Completion

Report the destination branch, resulting commit, PR URL when applicable, checks
actually run, and any remaining limitations. Verify the remote destination,
not merely the local branch. Do not claim success unless the requested changes
are landed. On a blocker, explicitly state that they have not landed and
identify the action needed to proceed.

Leave unrelated work untouched and do not delete branches or alter the user's
primary checkout as implicit cleanup.
