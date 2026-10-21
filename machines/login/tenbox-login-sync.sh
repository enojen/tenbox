#!/usr/bin/env bash
# Sends the claude.ai login, ~/.claude/.credentials.json, to two places: the bucket as
# login/credentials.json (machine.sh gives every machine the copy), and the Secrets of the
# box in namespace tenbox (claude-credentials, github-token, tracker, ntfy). It tries both and
# exits 1 when one failed. tenbox-login-sync.path runs it whenever the login changes.
# Reads ~/.config/tenbox/bucket, bucket-access-key, bucket-secret-key, github-token and
# tenbox.local.yaml of this repository. KUBECONFIG from the env, else ~/.kube/tenyard.yaml.
# No value goes on a command line or in the output: curl reads the bucket keys from stdin (-K -).
# Test: bash machines/login/test.sh (stub kubectl and curl in PATH).
set -euo pipefail
config="$HOME/.config/tenbox"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
manifest="$repo/tenbox.local.yaml"
file="$HOME/.claude/.credentials.json"
ns=tenbox
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/tenyard.yaml}"
line() { tr -d ' \n\r' < "$config/$1"; }
# One value of the local manifest: `  key: "value"` under its section.
manifest_value() { sed -n "s/^ *$1: *\"\{0,1\}\([^\"]*\)\"\{0,1\} *\$/\1/p" "$manifest" | tr -d '\n'; }
# `apply` replaces an existing Secret.
apply_secret() { kubectl -n "$ns" create secret generic "$@" --dry-run=client -o yaml | kubectl -n "$ns" apply -f - >/dev/null; }

upload_bucket() {
  local bucket location="${TENBOX_BUCKET_LOCATION:-hel1}"
  bucket="$(line bucket)" || return 1
  printf 'user = "%s:%s"\n' "$(line bucket-access-key)" "$(line bucket-secret-key)" |
    curl -sS -f -K - --aws-sigv4 "aws:amz:$location:s3" -T "$file" "https://$bucket.$location.your-objectstorage.com/login/credentials.json" || return 1
  echo "login uploaded to $bucket: $(jq -r '.claudeAiOauth.refreshTokenExpiresAt / 1000 | todate' "$file") refresh expiry"
}

write_secrets() {
  [ -s "$config/github-token" ] || { echo "no token at $config/github-token" >&2; return 1; }
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  apply_secret claude-credentials --from-file=credentials.json="$file" || return 1
  echo "secret claude-credentials written"
  apply_secret github-token --from-file=token="$config/github-token" || return 1
  echo "secret github-token written"
  [ -s "$manifest" ] || return 0
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
failed=0
upload_bucket || { echo "bucket upload failed" >&2; failed=1; }
write_secrets || { echo "Secrets write failed" >&2; failed=1; }
exit "$failed"
