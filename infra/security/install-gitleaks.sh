#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf '%s\n' 'Usage: install-gitleaks.sh destination [existing-archive]' >&2
  exit 2
fi
destination=$1
archive=${2:-}
if [[ -z "$archive" ]]; then
  archive=$(mktemp)
  trap 'rm -f -- "$archive"' EXIT
  curl --fail --silent --show-error --location \
    https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
    --output "$archive"
fi
printf '%s  %s\n' \
  551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb \
  "$archive" | sha256sum --check --status
mkdir -p -- "$destination"
tar --extract --gzip --file "$archive" --directory "$destination" gitleaks
"$destination/gitleaks" version
