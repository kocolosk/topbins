# Publisher authentication with Cloudflare Access

Viewing never requires sign-in. Only publisher operations and draft preview are
protected: `/api/publisher/*`, `/preview/*` and `/api/preview/*`.

## How it works

Cloudflare Access fronts those paths on `photos.kocolosk.net`. It signs a JWT and
sends it in `Cf-Access-Jwt-Assertion`. **The Worker does not trust the header's
presence.** `src/access.ts` verifies the RS256 signature against the team's
published keys (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`,
cached for an hour, refreshed at most once a minute for rotated keys), and checks
issuer, audience, expiry and not-before. A request that reaches the Worker without
passing Access (a misrouted hostname, a disabled-but-later-enabled `workers.dev`)
is therefore still rejected.

Who may publish is decided by Access policy, not by the Worker. The audience tag
binds a token to this one Access application.

| Configuration | Behavior |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` **and** `ACCESS_AUD` set | Access mode. Only a valid Access JWT is accepted; `PUBLISH_TOKEN` is ignored. |
| Only one of them set, or an invalid team domain | Access mode, fail closed: everything is denied. |
| Neither set | Local token mode: `PUBLISH_TOKEN` (Bearer; Basic `publisher:<token>` for browser preview). Unset token denies everything. |

Preview environments (`wrangler.preview.jsonc`) set neither Access variable and an
empty token, so publishing and draft preview stay unavailable there.

Both values are identifiers, not secrets. They belong in the ignored
`wrangler.remote.jsonc` `vars`, not in `wrangler.jsonc`. Do **not** also set a
`PUBLISH_TOKEN` secret in production.

## Setup record — 2026-11-13 (approved in this thread)

| Item | Value |
| --- | --- |
| Zero Trust org / team domain | `kocolosk.cloudflareaccess.com` |
| Access application | `topbins publisher`, `1a210151-4598-4da2-b531-3ae0d18eb56b` (self-hosted) |
| Destinations | `photos.kocolosk.net/api/publisher*`, `photos.kocolosk.net/preview*`, `photos.kocolosk.net/api/preview*` |
| AUD tag | `dd0e3017936a268f3c18f142c9a87d1617c798dd7103ebbffe1353bc70d29fe2` |
| Policies | Allow: exact email `adam@kocolosk.net` (one-time PIN or GitHub). Service Auth: service token `topbins publisher CLI` |
| Service token | `d875a88d-cc99-4474-9a47-35b236d04f76`; **expires 2027-11-14**: rotate before then |
| Session | 24h |
| Worker vars | `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` in the ignored `wrangler.remote.jsonc` |
| Production D1 | migrations 0002–0004 applied to `topbins-db` (no product data existed) |

The service token's Client ID/Secret were stored outside the repository at
`~/.config/topbins/access.env` (mode 600). The secret was displayed once during
setup in the agent session transcript; **rotate the token** if that transcript is
retained or shared. Existing apps and policies in the account were not modified,
and the shared "Allow Me" policy is deliberately not reused.

Verified against production after deployment: public routes (`/`, `/api/health`,
`/api/teams`) return 200; the three protected paths redirect to Access login
without credentials or with a wrong secret; the service token reaches the Worker
and passes its JWT verification; `workers.dev` returns 404. No media was published.

If the application must be rebuilt: keep exactly those three destinations, never
cover public routes, and keep `PUBLISH_TOKEN` unset in production.

## CLI

```sh
export TOPBINS_ACCESS_CLIENT_ID=...      # from your secret manager
export TOPBINS_ACCESS_CLIENT_SECRET=...  # never on the command line or in a file in the repo
mise exec -- npm run cli -- import ./exports --manifest ./match.json \
  --endpoint https://photos.kocolosk.net
```

`https://` endpoints send only the service-token headers, never the shared token.
Plain `http://` is accepted only for loopback and uses `TOPBINS_PUBLISH_TOKEN`.
The CLI does not follow redirects: an Access login redirect (wrong or expired
token, or a policy that excludes the path) stops with an explicit message.

## Lessons and remaining validation

Synthetic tests first missed a real bug: the key fetch used `redirect: "error"`,
which workerd does not support, so every real token failed closed. It was found by
replaying a real Access JWT against `wrangler dev`; the test stub now rejects that
option. Remaining unvalidated: the CLI's HTTPS path with a real import (no synthetic
media was published to production for this), and uploads near the 100,000,000-byte
video cap through Access and the account's request-body limit.
