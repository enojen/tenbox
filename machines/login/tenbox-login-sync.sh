#!/usr/bin/env bash
# Writes the claude.ai login, ~/.claude/.credentials.json, to the Secret claude-credentials of
# the box in namespace tenbox; exits 1 when it failed. The other Secrets of the box are tenyard's
# (`secrets/`, tools/apply-secrets.sh); the tracker key and the ntfy URL are per project:
# `tenbox machine run` writes them.
# tenbox-login-sync.path runs it whenever the login changes.
# KUBECONFIG from the env, else ~/.kube/tenyard.yaml. No value goes on a command line or in the output.
# Test: bash machines/login/test.sh (stub kubectl in PATH).
set -euo pipefail
file="$HOME/.claude/.credentials.json"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/tenyard.yaml}"
[ -s "$file" ] || { echo "no login at $file" >&2; exit 1; }
# `apply` replaces an existing Secret.
kubectl -n tenbox create secret generic claude-credentials --from-file=credentials.json="$file" \
  --dry-run=client -o yaml | kubectl -n tenbox apply -f - >/dev/null \
  || { echo "Secret write failed" >&2; exit 1; }
echo "secret claude-credentials written"
