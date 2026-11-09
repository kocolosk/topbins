#!/bin/sh
set -eu

# A separate command process does not inherit the build step's PATH changes.
. ./scripts/cloudflare-env.sh
exec "$PWD/.wrangler/build-tools/mise/bin/mise" exec -- node scripts/deploy-preview.ts
