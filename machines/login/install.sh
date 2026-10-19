#!/usr/bin/env bash
# Installs the login sync on this computer (Linux with systemd): the path unit watches
# ~/.claude/.credentials.json and the service uploads it. Uploads once right away.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
units="$HOME/.config/systemd/user"
mkdir -p "$units"
sed "s|%h/tenbox/machines/login|$here|" "$here/tenbox-login-sync.service" > "$units/tenbox-login-sync.service"
cp "$here/tenbox-login-sync.path" "$units/"
systemctl --user daemon-reload
systemctl --user enable --now tenbox-login-sync.path
systemctl --user start tenbox-login-sync.service
echo "login sync installed: systemctl --user status tenbox-login-sync.path"
