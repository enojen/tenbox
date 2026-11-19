#!/usr/bin/env bash
# Tests tenbox-login-sync.sh with a stub tenbox in PATH. Run: bash machines/login/test.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fails=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }

# One sandbox: HOME with the login, a copy of the script, and a tenbox that logs its argv.
setup() {
  root="$(mktemp -d)"
  export HOME="$root/home"
  mkdir -p "$HOME/.claude" "$root/bin" "$root/repo/machines/login"
  echo '{"claudeAiOauth":{"refreshTokenExpiresAt":1800000000000,"accessToken":"SECRET-LOGIN"}}' > "$HOME/.claude/.credentials.json"
  cp "$here/tenbox-login-sync.sh" "$root/repo/machines/login/"
  cat > "$root/bin/tenbox" <<'STUB'
#!/usr/bin/env bash
echo "tenbox $*" >> "$STUB_DIR/argv.log"
[ -z "${TENBOX_FAIL:-}" ] || exit 1
echo '{"ok":true,"agent":"a-1","changed":"2026-11-19T09:00:00Z"}'
STUB
  chmod +x "$root/bin/tenbox"
  export STUB_DIR="$root" PATH="$root/bin:$PATH"
  : > "$root/argv.log"
  unset TENBOX_FAIL
}
run() { bash "$root/repo/machines/login/tenbox-login-sync.sh" > "$root/out.log" 2>&1; }

setup; run; code=$?
check "exit 0 on success" '[ "$code" = 0 ]'
check "runs tenbox agent login once" '[ "$(cat "$root/argv.log")" = "tenbox agent login" ]'
check "no secret value in any argv" '! grep -q "SECRET-" "$root/argv.log"'
check "no secret value in the output" '! grep -q "SECRET-" "$root/out.log"'
check "no kubectl" '! grep -q kubectl "$root/repo/machines/login/tenbox-login-sync.sh"'

setup; rm "$HOME/.claude/.credentials.json"; run; code=$?
check "no login file: exit 1 and no tenbox call" '[ "$code" = 1 ] && [ ! -s "$root/argv.log" ]'

setup; TENBOX_FAIL=1 run; code=$?
check "tenbox failure: exit 1" '[ "$code" = 1 ]'
exit "$fails"
