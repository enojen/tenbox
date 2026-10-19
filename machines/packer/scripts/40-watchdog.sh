#!/usr/bin/env bash
# The watchdog: a timer that checks every minute whether a claude session still works.
set -euo pipefail

install -m 755 /tmp/watchdog/tenbox-watchdog.sh /usr/local/bin/tenbox-watchdog
install -m 644 /tmp/watchdog/tenbox-watchdog.service /etc/systemd/system/
install -m 644 /tmp/watchdog/tenbox-watchdog.timer /etc/systemd/system/
systemctl enable tenbox-watchdog.timer
