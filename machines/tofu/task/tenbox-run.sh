#!/usr/bin/env bash
# Starts one tenbox command on this machine as a transient unit tenbox-run-<time>: as tenzel,
# in the project's main checkout, detached so its claude session outlives the caller. Called
# by tenbox-boot on a new server and by machine.sh over ssh on a live one. The unit name is
# in /run/tenbox-run.unit; output in /var/log/tenbox-run.log, emptied for every command.
set -euo pipefail

cmd="${1:?tenbox command}"
home=/home/tenzel
main="$home/wt/$(jq -r .project /etc/tenbox-machine.json)/main"
# One unit per command: the claude session a command leaves behind keeps its unit loaded
# (KillMode=process), so the name of a finished command is not free again.
unit="tenbox-run-$(date +%s)"

install -o tenzel -g tenzel -m 644 /dev/null /var/log/tenbox-run.log
systemd-run --unit "$unit" --uid tenzel --gid tenzel --working-directory "$main" \
  --setenv HOME="$home" --setenv PATH=/usr/local/bin:/usr/bin:/bin -p KillMode=process \
  bash -c "$cmd >> /var/log/tenbox-run.log 2>&1"
echo "$unit" > /run/tenbox-run.unit
echo "$unit started: $cmd"
