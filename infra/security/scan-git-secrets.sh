#!/usr/bin/env bash
set -euo pipefail
if [[ $# -gt 1 ]]; then
  printf '%s\n' 'Usage: scan-git-secrets.sh [repository]' >&2
  exit 2
fi
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
scan_root=$(cd -- "${1:-$source_root}" && pwd -P)
# Upstream v8.30.1 loads source/.gitleaksignore in addition to an explicit ignore file.
# Reject it rather than deleting user files or silently accepting extra exemptions.
if [[ -e "$scan_root/.gitleaksignore" || -L "$scan_root/.gitleaksignore" ]]; then
  printf '%s\n' 'Unapproved source-local .gitleaksignore; use the protected historic fingerprint file.' >&2
  exit 1
fi
# Explicit defaults/ignore file and inline-allow rejection prevent source-local scan bypasses.
exec "${GITLEAKS_BIN:-gitleaks}" git "$scan_root" \
  --config "$source_root/.github/workflows/gitleaks-defaults.toml" \
  --gitleaks-ignore-path "$source_root/.github/workflows/gitleaks-history.ignore" \
  --ignore-gitleaks-allow \
  --log-opts='--no-ext-diff --no-textconv --full-history --diff-merges=first-parent HEAD' --exit-code=1 \
  --redact=100 --no-banner --log-level=error
