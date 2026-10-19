#!/usr/bin/env bash
# Leaves nothing of the build server in the image: no build key, no host keys, no machine id.
set -euo pipefail

rm -rf /tmp/tenbox.bundle /tmp/watchdog
apt-get clean
rm -rf /var/lib/apt/lists/*
rm -f /root/.ssh/authorized_keys
rm -f /etc/ssh/ssh_host_*
truncate -s 0 /etc/machine-id
cloud-init clean --logs
sync
