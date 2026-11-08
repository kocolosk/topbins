#!/bin/sh
# Source this from the repository root in BOTH Builds command processes.
# Cloudflare's image configures unrelated tools (including Hugo) globally.
# A scoped `mise install` is not enough: `mise run` and `mise exec` otherwise
# auto-install those inherited tools too.
project_root="$(pwd -P)"
export MISE_CONFIG_DIR="$project_root/.wrangler/build-tools/mise-config"
export MISE_GLOBAL_CONFIG_FILE="$MISE_CONFIG_DIR/config.toml"
export MISE_SYSTEM_CONFIG_FILE="$MISE_CONFIG_DIR/system.toml"
# Ceiling directories are excluded by mise, so stop at the repo's parent.
export MISE_CEILING_PATHS="$(dirname "$project_root")"
