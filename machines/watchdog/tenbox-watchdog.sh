#!/usr/bin/env bash
# Runs every minute from tenbox-watchdog.timer. Counts the claude sessions of tenzel that
# still work and logs how long the machine has been idle. Asking the control plane to shut
# the machine down comes with TEN-421; until then this only logs.
set -euo pipefail

IDLE_MINUTES="${IDLE_MINUTES:-5}"
state=/run/tenbox-watchdog
mkdir -p "$state"
now="$(date +%s)"

if ! sessions="$(sudo -u tenzel -H claude agents --json 2>/dev/null)"; then
  echo "cannot list sessions; counted as busy"
  echo "$now" > "$state/last-busy"
  exit 0
fi

busy="$(printf '%s' "$sessions" | jq '[.[] | select(.status == "busy" or .state == "working")] | length')"
if [ "$busy" -gt 0 ]; then
  echo "$now" > "$state/last-busy"
  echo "busy: $busy session(s)"
  exit 0
fi

[ -f "$state/last-busy" ] || echo "$now" > "$state/last-busy"
idle=$(( (now - $(cat "$state/last-busy")) / 60 ))
if [ "$idle" -ge "$IDLE_MINUTES" ]; then
  echo "idle for $idle min: ready to go down"
else
  echo "idle for $idle min"
fi
