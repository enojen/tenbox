#!/usr/bin/env bash
# Writes the claude.ai login, ~/.claude/.credentials.json, to the Secrets of the box in
# namespace tenbox (claude-credentials, github-token, tracker, ntfy); exits 1 when one failed.
# tenbox-login-sync.path runs it whenever the login changes.
# Reads ~/.config/tenbox/github-token and tenbox.local.yaml of this repository. KUBECONFIG
# from the env, else ~/.kube/tenyard.yaml. No value goes on a command line or in the output.
# Test: bash machines/login/test.sh (stub kubectl in PATH).
set -euo pipefail
config="$HOME/.config/tenbox"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
manifest="$repo/tenbox.local.yaml"
file="$HOME/.claude/.credentials.json"
ns=tenbox
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/tenyard.yaml}"
# One value of the local manifest: `  key: "value"` under its section.
manifest_value() { sed -n "s/^ *$1: *\"\{0,1\}\([^\"]*\)\"\{0,1\} *\$/\1/p" "$manifest" | tr -d '\n'; }
# `apply` replaces an existing Secret.
apply_secret() { kubectl -n "$ns" create secret generic "$@" --dry-run=client -o yaml | kubectl -n "$ns" apply -f - >/dev/null; }

write_secrets() {
  [ -s "$config/github-token" ] || { echo "no token at $config/github-token" >&2; return 1; }
  apply_secret claude-credentials --from-file=credentials.json="$file" || return 1
  echo "secret claude-credentials written"
  tr -d '[:space:]' < "$config/github-token" > "$tmp/token"
  apply_secret github-token --from-file=token="$tmp/token" || return 1
  echo "secret github-token written"
  [ -s "$manifest" ] || { echo "no tenbox.local.yaml at $manifest: tracker and ntfy skipped" >&2; return 0; }
  manifest_value api_key > "$tmp/api_key"
  manifest_value ntfy > "$tmp/url"
  if [ -s "$tmp/api_key" ]; then
    apply_secret tracker --from-file=api_key="$tmp/api_key" || return 1
    echo "secret tracker written"
  fi
  if [ -s "$tmp/url" ]; then
    apply_secret ntfy --from-file=url="$tmp/url" || return 1
    echo "secret ntfy written"
  fi
}

umask 077
[ -s "$file" ] || { echo "no login at $file" >&2; exit 1; }
# The temp dir holds the secret values: gone on exit, also on a stop of the service.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' TERM INT
write_secrets || { echo "Secrets write failed" >&2; exit 1; }
