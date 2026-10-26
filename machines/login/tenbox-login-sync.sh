#!/usr/bin/env bash
# Writes the claude.ai login, ~/.claude/.credentials.json, to the Secrets of the box in
# namespace tenbox (claude-credentials, github-token); exits 1 when one failed. The tracker key
# and the ntfy URL are per project: `tenbox machine run` writes them.
# tenbox-login-sync.path runs it whenever the login changes.
# Reads ~/.config/tenbox/github-token. KUBECONFIG from the env, else ~/.kube/tenyard.yaml.
# No value goes on a command line or in the output.
# Test: bash machines/login/test.sh (stub kubectl in PATH).
set -euo pipefail
config="$HOME/.config/tenbox"
file="$HOME/.claude/.credentials.json"
ns=tenbox
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/tenyard.yaml}"
# `apply` replaces an existing Secret.
apply_secret() { kubectl -n "$ns" create secret generic "$@" --dry-run=client -o yaml | kubectl -n "$ns" apply -f - >/dev/null; }

write_secrets() {
  [ -s "$config/github-token" ] || { echo "no token at $config/github-token" >&2; return 1; }
  apply_secret claude-credentials --from-file=credentials.json="$file" || return 1
  echo "secret claude-credentials written"
  tr -d '[:space:]' < "$config/github-token" > "$tmp/token"
  apply_secret github-token --from-file=token="$tmp/token" || return 1
  echo "secret github-token written"
}

umask 077
[ -s "$file" ] || { echo "no login at $file" >&2; exit 1; }
# The temp dir holds the token: gone on exit, also on a stop of the service.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' TERM INT
write_secrets || { echo "Secrets write failed" >&2; exit 1; }
