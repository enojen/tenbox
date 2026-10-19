#!/usr/bin/env bash
# Base packages and the tenzel user. Runs as root on the build server.
set -euo pipefail

apt-get update
apt-get upgrade -y
apt-get install -y --no-install-recommends ca-certificates curl git gnupg jq sudo unzip

useradd --create-home --shell /bin/bash tenzel
echo 'tenzel ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/tenzel
chmod 440 /etc/sudoers.d/tenzel
