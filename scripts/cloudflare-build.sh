#!/bin/sh
set -eu

# Workers Builds uses Ubuntu x64. Bootstrap the same mise release as GitHub CI,
# checking the release archive before executing it. Do not use curl | sh.
test "$(uname -s)-$(uname -m)" = "Linux-x86_64" || {
  echo "Cloudflare bootstrap requires Linux x64; locally use mise run check." >&2
  exit 1
}
tools="$PWD/.wrangler/build-tools"
mkdir -p "$tools"
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/jdx/mise/releases/download/v2026.9.12/mise-v2026.9.12-linux-x64.tar.gz \
  --output "$tools/mise.tar.gz"
printf '%s  %s\n' \
  b4058dece685259910d3aba5782445996eea79dbdb3cf952a6eb81aadf0373ff \
  "$tools/mise.tar.gz" | sha256sum --check
tar -xzf "$tools/mise.tar.gz" -C "$tools"
mise="$tools/mise/bin/mise"

export CI=true WRANGLER_SEND_METRICS=false
"$mise" trust mise.toml
"$mise" install --locked node conda:ffmpeg conda:exiftool
"$mise" run setup
"$mise" exec -- npm run doctor
"$mise" run check
git diff --exit-code
