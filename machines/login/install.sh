#!/usr/bin/env bash
# Installs the login sync on this computer (Linux with systemd): the path unit watches
# ~/.claude/.credentials.json and the service sends it to your default agent in Tenport with
# `tenbox agent login`. The service reads TENPORT_URL and TENPORT_TOKEN from
# ~/.config/tenbox/tenport.env, and finds tenbox and bun in the PATH this shell has (bun may come
# from asdf). Runs once right away.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
units="$HOME/.config/systemd/user"

tool_dir() {
  local found
  found="$(command -v "$1")" || return 1
  dirname "$found"
}

tool_path() {
  local dirs=() dir
  dir="$(tool_dir tenbox)" || { echo "no tenbox in PATH; run bun link in the tenbox checkout" >&2; return 1; }
  dirs+=("$dir")
  dir="$(tool_dir bun)" || { echo "no bun in PATH" >&2; return 1; }
  dirs+=("$dir")
  if dir="$(tool_dir asdf)"; then dirs+=("$dir"); fi
  printf '%s\n' "${dirs[@]}" /usr/local/bin /usr/bin /bin | awk '!seen[$0]++' | paste -sd:
}

path="$(tool_path)"
mkdir -p "$units"
sed -e "s|%h/tenbox/machines/login|$here|" -e "s|^Environment=PATH=.*|Environment=PATH=$path|" \
  "$here/tenbox-login-sync.service" > "$units/tenbox-login-sync.service"
cp "$here/tenbox-login-sync.path" "$units/"
systemctl --user daemon-reload
systemctl --user enable --now tenbox-login-sync.path
systemctl --user start tenbox-login-sync.service
echo "login sync installed: systemctl --user status tenbox-login-sync.path"
