#!/usr/bin/env bash
# Runs every minute from tenbox-watchdog.timer. The machine is busy while the last tenbox
# command given to it runs, while any tenbox command runs (a long `tenbox check`) or while a
# claude session works. After IDLE_MINUTES idle it asks the control plane, machine.yml in the
# control repo, to take the machine down, and asks again every RETRY_MINUTES while it is still
# here. `tenbox-watchdog busy` only prints the busy reason. The machine never deletes itself, so the state in the bucket stays true.
set -euo pipefail

IDLE_MINUTES="${IDLE_MINUTES:-5}"
RETRY_MINUTES="${RETRY_MINUTES:-10}"
state=/run/tenbox-watchdog
now="$(date +%s)"
as_tenzel() { sudo -u tenzel -H "$@"; }
minutes_since() { echo $(( (now - $(cat "$1")) / 60 )); }

busy_reason() {
  if systemctl is-active --quiet 'tenbox-run-*'; then
    echo "the last tenbox command still runs"
    return
  fi
  if pgrep -u tenzel -f /home/tenzel/tenbox/cli/main.ts > /dev/null; then
    echo "a tenbox command runs"
    return
  fi
  local sessions working
  if ! sessions="$(as_tenzel claude agents --json 2> /dev/null)"; then
    echo "cannot list sessions"
    return
  fi
  working="$(printf '%s' "$sessions" | jq '[.[] | select(.status == "busy" or .state == "working")] | length')"
  if [ "$working" -gt 0 ]; then
    echo "$working session(s) work"
  fi
}

# `tenbox-watchdog busy`: print `busy: <reason>`, nothing when idle. machine.sh down asks
# this before it deletes the server; it neither asks for down nor writes the state.
if [ "${1:-}" = busy ]; then
  reason="$(busy_reason)"
  [ -z "$reason" ] || echo "busy: $reason"
  exit 0
fi

mkdir -p "$state"
reason="$(busy_reason)"
if [ -n "$reason" ]; then
  echo "$now" > "$state/last-busy"
  echo "busy: $reason"
  exit 0
fi

[ -f "$state/last-busy" ] || echo "$now" > "$state/last-busy"
idle="$(minutes_since "$state/last-busy")"
if [ "$idle" -lt "$IDLE_MINUTES" ]; then
  echo "idle for $idle min"
  exit 0
fi
if [ -f "$state/down-requested" ] && [ "$(minutes_since "$state/down-requested")" -lt "$RETRY_MINUTES" ]; then
  echo "idle for $idle min, down requested"
  exit 0
fi

control="$(jq -r .control /etc/tenbox-machine.json)"
task="$(jq -r .task /etc/tenbox-machine.json)"
as_tenzel gh workflow run machine.yml -R "$control" -f "task=$task" -f cmd=down
echo "$now" > "$state/down-requested"
echo "idle for $idle min: asked $control to take the machine down"
