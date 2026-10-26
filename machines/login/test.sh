#!/usr/bin/env bash
# Tests tenbox-login-sync.sh with a stub kubectl in PATH. Run: bash machines/login/test.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fails=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }

# One sandbox: HOME with the login and the config files, a copy of the script in a fake repo.
setup() {
  root="$(mktemp -d)"
  export HOME="$root/home"
  mkdir -p "$HOME/.claude" "$HOME/.config/tenbox" "$root/bin" "$root/repo/machines/login"
  echo '{"claudeAiOauth":{"refreshTokenExpiresAt":1800000000000,"accessToken":"SECRET-LOGIN"}}' > "$HOME/.claude/.credentials.json"
  printf 'SECRET-GHTOKEN\n' > "$HOME/.config/tenbox/github-token"
  cp "$here/tenbox-login-sync.sh" "$root/repo/machines/login/"
  cat > "$root/repo/tenbox.local.yaml" <<YAML
tracker:
  api_key: "SECRET-TRACKER"
notify:
  ntfy: "https://ntfy.sh/SECRET-NTFY"
YAML
  # kubectl logs argv to argv.log; `create` also logs the secret and the content of its files,
  # each newline as `~`, so a trailing newline in a value shows.
  cat > "$root/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
echo "kubectl $*" >> "$STUB_DIR/argv.log"
[ -z "${KUBECTL_FAIL:-}" ] || exit 1
# KUBECTL_KILL: a stop of the service, SIGTERM to the script while kubectl runs.
[ -z "${KUBECTL_KILL:-}" ] || { kill -TERM "$PPID"; sleep 1; exit 1; }
if [ "$3" = create ]; then
  name="$6"
  for a in "$@"; do
    case "$a" in --from-file=*) kv="${a#--from-file=}"; echo "$name ${kv%%=*}=$(tr '\n' '~' < "${kv#*=}")" >> "$STUB_DIR/secrets.log" ;; esac
  done
else cat > /dev/null; fi
STUB
  chmod +x "$root/bin/kubectl"
  export STUB_DIR="$root" PATH="$root/bin:$PATH"
  : > "$root/argv.log"; : > "$root/secrets.log"
  unset KUBECTL_FAIL KUBECTL_KILL
}
run() { bash "$root/repo/machines/login/tenbox-login-sync.sh" > "$root/out.log" 2>&1; }

setup; run; code=$?
check "exit 0 on success" '[ "$code" = 0 ]'
check "claude-credentials gets the login" 'grep -q "^claude-credentials credentials.json=.*SECRET-LOGIN" "$root/secrets.log"'
check "github-token gets the token without its trailing newline" 'grep -qx "github-token token=SECRET-GHTOKEN" "$root/secrets.log"'
check "tracker gets api_key" 'grep -qx "tracker api_key=SECRET-TRACKER" "$root/secrets.log"'
check "ntfy gets url" 'grep -qx "ntfy url=https://ntfy.sh/SECRET-NTFY" "$root/secrets.log"'
check "every kubectl call uses namespace tenbox" '! grep "^kubectl " "$root/argv.log" | grep -qv "^kubectl -n tenbox "'
check "no secret value in any argv" '! grep -q "SECRET-" "$root/argv.log"'
check "no secret value in the output" '! grep -q "SECRET-" "$root/out.log"'

setup; printf 'tracker:\n  api_key: ""\nnotify:\n  ntfy: ""\n' > "$root/repo/tenbox.local.yaml"; run; code=$?
check "empty values: exit 0" '[ "$code" = 0 ]'
check "empty values: tracker and ntfy skipped" '! grep -q -e "^tracker " -e "^ntfy " "$root/secrets.log"'
check "empty values: the other two still written" '[ "$(wc -l < "$root/secrets.log")" = 2 ]'

setup; KUBECTL_FAIL=1 run; code=$?
check "kubectl failure: exit 1" '[ "$code" = 1 ]'


setup; mkdir "$root/tmp"; TMPDIR="$root/tmp" KUBECTL_KILL=1 run
check "SIGTERM during kubectl: no temp file left" '[ -z "$(ls -A "$root/tmp")" ]'

setup; rm "$root/repo/tenbox.local.yaml"; run; code=$?
check "no manifest: exit 0" '[ "$code" = 0 ]'
check "no manifest: a line says tracker and ntfy are skipped" 'grep -q "no tenbox.local.yaml at .*: tracker and ntfy skipped" "$root/out.log"'
exit "$fails"
