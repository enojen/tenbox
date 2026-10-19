#!/usr/bin/env bash
# machine.sh from your computer, with the secrets the workflow has, read from files:
#   ~/.config/tenbox/hcloud-token, github-token, bucket (the bucket name, one line),
#   bucket-access-key, bucket-secret-key; ~/.ssh/id_ed25519_tenbox_machine; notify.ntfy and
#   tracker.api_key from this repo's tenbox.local.yaml. Same arguments as machine.sh.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
config="$HOME/.config/tenbox"
line() { tr -d ' \n\r' < "$config/$1"; }
yaml() { # <section> <key>: one value of this repo's tenbox.local.yaml
  grep -A3 "^$1:" "$here/../tenbox.local.yaml" 2> /dev/null | grep "^  $2:" | sed -E 's/^ *[a-z_]+: *"?([^"]*)"?.*/\1/' || true
}

HCLOUD_TOKEN="$(line hcloud-token)" MACHINE_GITHUB_TOKEN="$(line github-token)" \
  TENBOX_BUCKET="$(line bucket)" BUCKET_ACCESS_KEY="$(line bucket-access-key)" \
  BUCKET_SECRET_KEY="$(line bucket-secret-key)" \
  MACHINE_SSH_KEY_FILE="$HOME/.ssh/id_ed25519_tenbox_machine" \
  NTFY_URL="$(yaml notify ntfy)" TRACKER_API_KEY="$(yaml tracker api_key)" \
  exec "$here/machine.sh" "$@"
