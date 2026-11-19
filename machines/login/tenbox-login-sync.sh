#!/usr/bin/env bash
# Sends the claude.ai login, ~/.claude/.credentials.json, to your default agent in Tenport with
# `tenbox agent login`; Tenport writes it to the Secret of the agent, which the box reads. Exits 1
# when it failed. tenbox-login-sync.path runs it whenever the login changes. TENPORT_URL and
# TENPORT_TOKEN come from the env (the service reads ~/.config/tenbox/tenport.env). No value goes
# on a command line or in the output.
# Test: bash machines/login/test.sh (stub tenbox in PATH).
set -euo pipefail
file="$HOME/.claude/.credentials.json"
[ -s "$file" ] || { echo "no login at $file" >&2; exit 1; }
tenbox agent login >/dev/null || { echo "login send to Tenport failed" >&2; exit 1; }
echo "login sent to Tenport"
